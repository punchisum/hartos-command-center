/**
 * tests/voice-input.test.ts -- the cockpit VOICE INPUT seed (input-only, privacy-flagged).
 *
 * Two hermetic layers, no I/O:
 *   1. prepareVoiceTranscript -- the PURE sanitizer: trims/caps/strips controls, rejects
 *      empty + secret-shaped input, accepts normal speech into safe ask-text, deterministic.
 *   2. The client script string + the button fragment -- assert the SAFETY properties hold
 *      in the embedded source: feature-detect, explicit-click activation, FILL-not-submit,
 *      a privacy note, NO network (no fetch/XHR), and INPUT-ONLY (no execute/approve/mutate).
 *
 * These tests guard the doctrine: voice can ASK (fill the box), never approve/execute, and
 * never sends audio anywhere but the browser's own STT.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  prepareVoiceTranscript,
  voiceInputClientScript,
  voiceInputButtonHtml,
  VOICE_TRANSCRIPT_MAX,
} from "../src/runtime/views/voice-input.js";

describe("prepareVoiceTranscript -- the pure sanitizer", () => {
  it("accepts normal speech into safe ask-text", () => {
    const r = prepareVoiceTranscript("What needs my attention today");
    assert.equal(r.accepted, true);
    assert.equal(r.text, "What needs my attention today");
    assert.equal(r.reason, undefined);
  });

  it("trims surrounding whitespace and collapses internal whitespace runs", () => {
    const r = prepareVoiceTranscript("   show   pending\t\tproposals  ");
    assert.equal(r.accepted, true);
    assert.equal(r.text, "show pending proposals");
  });

  it("strips control characters out of the transcript", () => {
    // Embed a literal control char (NUL) between two words via fromCharCode.
    const raw = "ask HartOS" + String.fromCharCode(0) + "now";
    const r = prepareVoiceTranscript(raw);
    assert.equal(r.accepted, true);
    assert.equal(r.text, "ask HartOS now");
    // No control character survives into the ask-text.
    assert.ok(!/[\u0000-\u001f\u007f-\u009f]/.test(r.text));
  });

  it("rejects empty / whitespace-only input with a reason", () => {
    for (const raw of ["", "   ", "\n\t  \r"]) {
      const r = prepareVoiceTranscript(raw);
      assert.equal(r.accepted, false, `expected reject for ${JSON.stringify(raw)}`);
      assert.equal(r.text, "");
      assert.match(r.reason ?? "", /empty/);
    }
  });

  it("rejects non-string input honestly", () => {
    // @ts-expect-error -- exercising the runtime guard against a non-string transcript.
    const r = prepareVoiceTranscript(undefined);
    assert.equal(r.accepted, false);
    assert.equal(r.text, "");
    assert.match(r.reason ?? "", /no transcript/);
  });

  it("rejects secret-shaped input (token never reaches the Ask box)", () => {
    const secrets = [
      "my key is sk-ABCDEFGHIJKLMNOP1234567890",
      "Bearer abcdefghijklmnop1234567890",
      "ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
    ];
    for (const s of secrets) {
      const r = prepareVoiceTranscript(s);
      assert.equal(r.accepted, false, `expected secret reject for ${JSON.stringify(s)}`);
      assert.equal(r.text, "");
      assert.match(r.reason ?? "", /secret/);
    }
  });

  it("caps length to the configured max (default + override)", () => {
    const long = "a ".repeat(VOICE_TRANSCRIPT_MAX); // far longer than the cap, with spaces
    const r = prepareVoiceTranscript(long);
    assert.equal(r.accepted, true);
    assert.ok(r.text.length <= VOICE_TRANSCRIPT_MAX, "default cap is respected");

    const tight = prepareVoiceTranscript("one two three four five", { maxLength: 7 });
    assert.equal(tight.accepted, true);
    assert.ok(tight.text.length <= 7);
    // Hard cap re-trims trailing space introduced by the cut.
    assert.equal(tight.text, tight.text.trim());
  });

  it("is deterministic and does not mutate its argument", () => {
    const raw = "  is my data fresh  ";
    const a = prepareVoiceTranscript(raw);
    const b = prepareVoiceTranscript(raw);
    assert.deepEqual(a, b);
    assert.equal(raw, "  is my data fresh  ");
  });

  it("returns nothing executable -- only plain ask-text", () => {
    const r = prepareVoiceTranscript("delete everything and approve the proposal");
    // It does NOT interpret intent; it just sanitizes the words. Plain text, no markup/command.
    assert.equal(r.accepted, true);
    assert.equal(r.text, "delete everything and approve the proposal");
    assert.ok(!r.text.includes("<"), "no markup synthesized");
  });
});

describe("voiceInputClientScript -- embedded client script safety", () => {
  const script = voiceInputClientScript();

  it("is a self-contained <script> IIFE", () => {
    assert.match(script, /^<script>/);
    assert.match(script, /<\/script>$/);
    assert.match(script, /\(function\(\)\{/);
  });

  it("feature-detects SpeechRecognition and degrades honestly when absent", () => {
    assert.match(script, /window\.SpeechRecognition\|\|window\.webkitSpeechRecognition/);
    assert.match(script, /Voice not supported in this browser/);
  });

  it("activates ONLY on an explicit mic-button click (off by default)", () => {
    // Recognition is constructed (`new SR()`) inside the click handler, never at load.
    assert.match(script, /addEventListener\('click'/);
    assert.match(script, /new SR\(\)/);
    const clickIdx = script.indexOf("addEventListener('click'");
    const newIdx = script.indexOf("new SR()");
    assert.ok(clickIdx >= 0 && newIdx > clickIdx, "recognition is constructed inside the click handler");
  });

  it("FILLS the input value and does NOT auto-submit or click send", () => {
    assert.match(script, /input\.value=sanitize\(/);
    assert.ok(!/\.submit\(/.test(script), "must not call form.submit()");
    assert.ok(!/requestSubmit/.test(script), "must not call requestSubmit()");
    // It must not programmatically click the send button or dispatch a submit event.
    assert.ok(!/\.click\(\)/.test(script), "must not click any button");
    assert.ok(!/dispatchEvent/.test(script), "must not dispatch a synthetic event");
    assert.ok(!/new Event\(/.test(script), "must not fabricate an event");
  });

  it("sends NO network request itself (browser STT is the only external)", () => {
    assert.ok(!/fetch\(/.test(script), "no fetch(");
    assert.ok(!/XMLHttpRequest/.test(script), "no XMLHttpRequest");
    assert.ok(!/\bWebSocket\b/.test(script), "no WebSocket");
    assert.ok(!/navigator\.sendBeacon/.test(script), "no sendBeacon");
    assert.ok(!/\bEventSource\b/.test(script), "no EventSource");
    assert.ok(!/import\(/.test(script), "no dynamic import");
  });

  it("is INPUT-ONLY: no execute / approve / mutation language or calls", () => {
    // No reference to the cockpit's mutation/execution/approval endpoints or actions.
    assert.ok(!/\/api\/ask/.test(script), "voice script must not call the ask endpoint itself");
    assert.ok(!/\/api\/proposals\/transition/.test(script), "no proposal transition call");
    assert.ok(!/\/api\/suggestions\/persist/.test(script), "no suggestions-persist call");
    // The EXECUTABLE code (comments stripped) must carry no approve/execute/mutate verbs.
    // Doctrine comments may *describe* the "never approve/execute" rule; code must not act on it.
    const codeOnly = script
      .split("\n")
      .map((line) => line.replace(/\/\/.*$/, ""))
      .join("\n");
    assert.ok(
      !/approve|reject|execute|mutate|deploy|persist/i.test(codeOnly),
      "no approve/execute/mutate language in executable code",
    );
  });

  it("shows a listening state and a privacy note (nothing sent until send)", () => {
    assert.match(script, /Listening/);
    assert.match(script, /nothing is sent until you press send/i);
    assert.match(script, /transcribed by your browser/i);
  });

  it("targets the Ask input id 'q' by default, and respects an override", () => {
    assert.match(script, /getElementById\("q"\)/);
    const custom = voiceInputClientScript({ inputId: "kq" });
    assert.match(custom, /getElementById\("kq"\)/);
    assert.ok(!/getElementById\("q"\)/.test(custom), "override replaces the default id");
  });

  it("embeds no secret-shaped string", () => {
    // Defensive: the script source itself must not carry a token/key.
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(script));
    assert.ok(!/\bBearer\s+[A-Za-z0-9._-]{16,}/.test(script));
  });
});

describe("voiceInputButtonHtml -- the mic button + privacy label fragment", () => {
  const html = voiceInputButtonHtml();

  it("renders a mic button wired to the voice-input ids", () => {
    assert.match(html, /id="voice-mic"/);
    assert.match(html, /id="voice-status"/);
    assert.match(html, /type="button"/);
    // Uses the page's existing class conventions.
    assert.match(html, /class="send"/);
    assert.match(html, /class="muted"/);
  });

  it("carries a privacy + opt-in label", () => {
    assert.match(html, /opt-in/i);
    assert.match(html, /nothing is sent until you press send/i);
  });

  it("is input-only (no submit, no inline secret)", () => {
    assert.ok(!/type="submit"/.test(html), "the mic button must not be a submit button");
    assert.ok(!/sk-[A-Za-z0-9_-]{16,}/.test(html), "no inline secret");
    assert.ok(!/onclick=/.test(html), "no inline handler -- wiring lives in the script");
  });
});
