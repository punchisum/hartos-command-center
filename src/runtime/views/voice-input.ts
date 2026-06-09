/**
 * src/runtime/views/voice-input.ts
 *
 * A VOICE INPUT seed for the hosted cockpit Ask bar -- INPUT ONLY, privacy-flagged,
 * opt-in. A browser-side mic button uses the Web Speech API (SpeechRecognition) to
 * transcribe speech and FILL the Ask box (`#q`). It does NOT auto-submit, does NOT
 * execute/approve anything, and sends NO audio anywhere but the browser's own STT.
 *
 * Doctrine: voice can ASK, never approve/execute. The human still presses send.
 *
 * Three exports, all Worker-safe (pure string/logic; NO Node-only import):
 *   - prepareVoiceTranscript(raw, opts) -> a PURE transcript sanitizer (the safe ask-text
 *     that would fill `#q`). Deterministic, no I/O. Rejects empty / secret-shaped input.
 *   - voiceInputClientScript(opts)      -> the self-contained <script> body (a TS string).
 *   - voiceInputButtonHtml()            -> the mic button + privacy-flagged label fragment.
 *
 * The Commander injects `voiceInputButtonHtml()` into the page near the Ask bar and
 * `voiceInputClientScript()` alongside the existing client scripts. This module renders
 * in the Worker, so it must stay pure: `containsSecret` from src/llm/redaction.ts is
 * pure/Worker-safe (regex-only, no I/O) and is reused here for the secret-shaped reject.
 */

import { containsSecret } from "../../llm/redaction.js";

/** Max characters a transcript may fill into the Ask box. Long enough for a spoken ask,
 * short enough to refuse a runaway dictation. Mirrored client-side in the script. */
export const VOICE_TRANSCRIPT_MAX = 600;

/** Strip ASCII + C1 control characters (incl. NUL, line/paragraph separators) to a space.
 * Built from \u escapes via RegExp so the source stays pure ASCII (no literal controls). */
const CONTROL_CHARS = new RegExp("[\\u0000-\\u001f\\u007f-\\u009f]", "g");

export interface PrepareVoiceTranscriptOptions {
  /** Override the length cap (defaults to VOICE_TRANSCRIPT_MAX). */
  maxLength?: number;
}

export interface PreparedVoiceTranscript {
  /** The sanitized ask-text that would FILL the Ask box. Empty string when not accepted. */
  text: string;
  /** True only when the transcript is safe to fill into the Ask box. */
  accepted: boolean;
  /** Honest reason when `accepted` is false. */
  reason?: string;
}

/**
 * PURE: sanitize a raw speech transcript into safe ask-text that would FILL the Ask box.
 *
 * Never returns anything executable -- it only trims, strips control characters, caps
 * length, and refuses empty or secret-shaped input. Deterministic; performs no I/O and
 * never mutates its argument. The returned `text` is plain ask-text, identical to what a
 * human could have typed; it carries no command/approval semantics of its own.
 */
export function prepareVoiceTranscript(
  raw: string,
  opts: PrepareVoiceTranscriptOptions = {},
): PreparedVoiceTranscript {
  const max = opts.maxLength ?? VOICE_TRANSCRIPT_MAX;

  if (typeof raw !== "string") {
    return { text: "", accepted: false, reason: "no transcript" };
  }

  // Strip control characters; collapse whitespace runs into single spaces so a dictation
  // reads like one typed line; trim the ends.
  const cleaned = raw.replace(CONTROL_CHARS, " ").replace(/\s+/g, " ").trim();

  if (cleaned.length === 0) {
    return { text: "", accepted: false, reason: "empty transcript" };
  }

  // Refuse secret-shaped input outright -- a transcript must never carry a token/key into
  // the Ask box (where it could be echoed/logged). Reuse the pure Worker-safe detector.
  if (containsSecret(cleaned)) {
    return { text: "", accepted: false, reason: "looks like a secret" };
  }

  // Hard-cap length and re-trim any trailing space the cut may have produced.
  const capped = cleaned.length > max ? cleaned.slice(0, max).trim() : cleaned;
  if (capped.length === 0) {
    return { text: "", accepted: false, reason: "empty transcript" };
  }

  return { text: capped, accepted: true };
}

export interface VoiceInputClientScriptOptions {
  /** The Ask input element id to FILL (defaults to "q" -- the inline Ask bar input). */
  inputId?: string;
  /** The mic button element id (defaults to "voice-mic"). */
  buttonId?: string;
  /** The status/label element id (defaults to "voice-status"). */
  statusId?: string;
  /** The length cap mirrored client-side (defaults to VOICE_TRANSCRIPT_MAX). */
  maxLength?: number;
}

/**
 * The self-contained client <script> body (as a TS string) for the voice seed.
 *
 * Safety properties (asserted in tests, enforced here):
 *   - OFF by default: SpeechRecognition is only constructed on an explicit mic-button click.
 *   - Feature-detected: if `SpeechRecognition || webkitSpeechRecognition` is absent, the
 *     button shows an honest "voice not supported in this browser" state and does nothing.
 *   - INPUT ONLY: on a final transcript it sets `input.value` (mirroring the pure sanitize
 *     rules) and NEVER submits the form, never clicks send, never executes/approves.
 *   - NO network: the script issues no fetch/XHR -- the browser's STT is the only external.
 *   - Privacy + opt-in: shows a "listening" status and a privacy note that nothing is sent
 *     until the user presses send.
 */
export function voiceInputClientScript(opts: VoiceInputClientScriptOptions = {}): string {
  const inputId = opts.inputId ?? "q";
  const buttonId = opts.buttonId ?? "voice-mic";
  const statusId = opts.statusId ?? "voice-status";
  const max = opts.maxLength ?? VOICE_TRANSCRIPT_MAX;
  // JSON.stringify keeps the ids/number safely embedded (matches the page's login-script style).
  const INPUT = JSON.stringify(inputId);
  const BTN = JSON.stringify(buttonId);
  const STATUS = JSON.stringify(statusId);
  const PRIVACY = JSON.stringify(
    "Speech is transcribed by your browser; nothing is sent until you press send.",
  );

  return `<script>
(function(){
  // Voice input SEED -- INPUT ONLY, opt-in, privacy-flagged. Voice can ASK, never approve/execute.
  // Fills the Ask box; the human still presses send. No network here; the browser STT is the only external.
  var MAX=${max};
  var input=document.getElementById(${INPUT});
  var btn=document.getElementById(${BTN});
  var status=document.getElementById(${STATUS});
  if(!input||!btn){return;}
  function setStatus(t){if(status){status.textContent=t||${PRIVACY};}}
  // Pure client-side sanitize -- mirrors prepareVoiceTranscript: strip control chars,
  // collapse whitespace, trim, cap length. Returns plain ask-text only (never executable).
  function sanitize(raw){
    var s=String(raw==null?'':raw).replace(/[\\u0000-\\u001f\\u007f-\\u009f]/g,' ').replace(/\\s+/g,' ').trim();
    if(s.length>MAX){s=s.slice(0,MAX).trim();}
    return s;
  }
  // Feature-detect: absent -> honest "not supported" state, opt-in click does nothing.
  var SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR){
    btn.setAttribute('aria-disabled','true');
    btn.title='Voice not supported in this browser';
    setStatus('Voice not supported in this browser.');
    btn.addEventListener('click',function(e){e.preventDefault();setStatus('Voice not supported in this browser.');});
    return;
  }
  var rec=null,listening=false;
  function stop(){
    listening=false;
    if(rec){try{rec.stop();}catch(_){}}
    btn.setAttribute('aria-pressed','false');
    setStatus(${PRIVACY});
  }
  // OFF by default -- recognition is constructed and started ONLY on this explicit click.
  btn.addEventListener('click',function(e){
    e.preventDefault();
    if(listening){stop();return;}
    rec=new SR();
    rec.lang='en-US';
    rec.interimResults=true;
    rec.continuous=false;
    rec.onresult=function(ev){
      var finalText='';
      for(var i=ev.resultIndex;i<ev.results.length;i++){
        if(ev.results[i].isFinal){finalText+=ev.results[i][0].transcript;}
      }
      // INPUT ONLY: fill the Ask box with the sanitized final transcript. Do NOT submit,
      // do NOT click send, do NOT execute -- the human still presses send.
      if(finalText){input.value=sanitize(finalText);input.focus();}
    };
    rec.onerror=function(){setStatus('Voice error -- nothing was sent.');};
    rec.onend=function(){stop();};
    listening=true;
    btn.setAttribute('aria-pressed','true');
    setStatus('Listening... speak your ask. Nothing is sent until you press send.');
    try{rec.start();}catch(_){stop();}
  });
})();
</script>`;
}

/**
 * The mic button + privacy-flagged label fragment, to sit next to the Ask box.
 * Plain HTML string using the page's existing class conventions (`.send` button style +
 * a `.muted` privacy note). No inline secret. Input-only -- it triggers the voice seed,
 * which fills `#q`; it never submits or executes.
 */
export function voiceInputButtonHtml(): string {
  return (
    `<button class="send" id="voice-mic" type="button" aria-pressed="false"` +
    ` title="Speak your ask (input only -- fills the box, you still press send)"` +
    ` aria-label="Voice input -- fills the Ask box, does not send">&#127908;</button>` +
    `<span class="muted" id="voice-status">Voice input is opt-in. ` +
    `Speech is transcribed by your browser; nothing is sent until you press send.</span>`
  );
}
