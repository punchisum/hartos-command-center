/**
 * tests/relay-ask-infer.test.ts — P-B3 relay AskInfer + P-B2 daemon pass.
 *
 * Covers:
 *   - buildRelayAskInfer: flag off → undefined (today's Gemini path)
 *   - buildRelayAskInfer: flag on but missing env → undefined (safe fallback)
 *   - buildRelayAskInfer: answered poll → returns LlmResult (provider=claude-max)
 *   - buildRelayAskInfer: timeout (clock exhausted before answered) → null → fallback
 *   - buildRelayAskInfer: insert non-ok → null → fallback
 *   - buildRelayAskInfer: expired status → null → fallback
 *   - buildRelayAskInfer: malformed answer → null → fallback
 *   - buildRelayAskInfer: secret in request detected (redaction contract already done by orchestrator;
 *       the relay passes the already-redacted string through — test confirms it is forwarded as-is)
 *   - runAskRelayOnce: HARTOS_ASK_RELAY not set → [] (disarmed no-op)
 *   - runAskRelayOnce: armed + injected DB + injected infer → writes an answer
 *   - runAskRelayOnce: armed + infer returns null → writes error
 *   - runAskRelayOnce: armed + secret in answer → rejects + writes error
 *
 * No network. All fetch / DB / infer are injected.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildRelayAskInfer } from "../src/llm/relay-ask-infer.js";
import { runAskRelayOnce } from "../scripts/run-ask-relay-pass.js";
import type { LlmResult, LlmStructuredOutput } from "../src/llm/llm-types.js";
import type { AskRelayDeps } from "../scripts/run-ask-relay-pass.js";

// ── Shared fixtures ──────────────────────────────────────────────────────────

const VALID_OUTPUT: LlmStructuredOutput = {
  intent: "daily_brief",
  domain: "fitness",
  confidence: "high",
  neededContext: [],
  recommendedSpecialist: "fitness_agent",
  riskLevel: "low",
  nextAction: "review workout plan",
  summary: "Claude-Max: fitness looks good, stay on track.",
};

function makeValidResult(overrides: Partial<LlmResult> = {}): LlmResult {
  return {
    output: VALID_OUTPUT,
    provider: "claude-max",
    model: "claude-opus-4-5",
    mode: "claude-max",
    validation: "valid",
    success: true,
    requestType: "classify_and_contextualize",
    ...overrides,
  };
}

/** Minimal relay env with all required vars. */
const RELAY_ENV: Record<string, string> = {
  HARTOS_ASK_VIA_RELAY: "true",
  HARTOS_ASK_RELAY_URL: "https://xbuinrnpfjltimofwrdx.supabase.co/functions/v1/relay-ask",
  HARTOS_ASK_WRITE_TOKEN: "test-capability-token",
  HARTOS_FITNESS_SUPABASE_URL: "https://xbuinrnpfjltimofwrdx.supabase.co",
  HARTOS_FITNESS_SUPABASE_READONLY_KEY: "anon-key-test",
};

/** Fake fetch factory for the relay client tests. */
type FetchCall = { url: string; init?: RequestInit };
interface FakeFetchResult {
  fetch: typeof fetch;
  calls: () => FetchCall[];
}

function makeFakeFetch(
  responses: Array<{ ok: boolean; body: unknown; status?: number }>,
): FakeFetchResult {
  const calls: FetchCall[] = [];
  let idx = 0;
  const fakeFetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    calls.push({ url: String(url), init });
    const resp = responses[idx] ?? { ok: false, body: { error: "no more responses" }, status: 500 };
    idx += 1;
    const bodyText = JSON.stringify(resp.body);
    return new Response(bodyText, {
      status: resp.ok ? (resp.status ?? 200) : (resp.status ?? 500),
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch: fakeFetch as unknown as typeof fetch, calls: () => calls };
}

// ── buildRelayAskInfer tests ──────────────────────────────────────────────────

describe("buildRelayAskInfer", () => {
  it("flag off → returns undefined (today's path is used)", () => {
    const env = { ...RELAY_ENV, HARTOS_ASK_VIA_RELAY: "false" };
    const infer = buildRelayAskInfer(env);
    assert.equal(infer, undefined, "should return undefined when flag is off");
  });

  it("flag unset → returns undefined", () => {
    const env = { ...RELAY_ENV };
    delete env["HARTOS_ASK_VIA_RELAY"];
    const infer = buildRelayAskInfer(env);
    assert.equal(infer, undefined);
  });

  it("flag on but relay URL missing → returns undefined (safe fallback)", () => {
    const env = { ...RELAY_ENV };
    delete env["HARTOS_ASK_RELAY_URL"];
    const infer = buildRelayAskInfer(env);
    assert.equal(infer, undefined, "missing relay URL → undefined so caller uses Gemini");
  });

  it("flag on but write token missing → returns undefined", () => {
    const env = { ...RELAY_ENV };
    delete env["HARTOS_ASK_WRITE_TOKEN"];
    const infer = buildRelayAskInfer(env);
    assert.equal(infer, undefined);
  });

  it("flag on but read URL missing → returns undefined", () => {
    const env = { ...RELAY_ENV };
    delete env["HARTOS_FITNESS_SUPABASE_URL"];
    const infer = buildRelayAskInfer(env);
    assert.equal(infer, undefined);
  });

  it("answered poll → returns the LlmResult (provider=claude-max)", async () => {
    const result = makeValidResult();
    // Responses: 1) insert ok, 2) first poll returns answered
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { ok: true, body: { ok: true, id: "test-id" } }, // insert
      { ok: true, body: [{ status: "answered", answer: result, provider: "claude-max", error: null, answered_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120_000).toISOString() }] }, // poll
    ]);
    let clockMs = 0;
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch, () => clockMs);
    assert.ok(infer, "should return an AskInfer when flag is on + env configured");

    const answer = await infer!("what should I do today?", { intent: "daily_brief" });
    assert.ok(answer !== null, "should return the LlmResult on answered status");
    assert.equal(answer!.provider, "claude-max");
    assert.equal(answer!.mode, "claude-max");
    assert.equal(answer!.success, true);
    assert.equal(answer!.output.summary, VALID_OUTPUT.summary);

    // Verify the insert call used the correct authorization header.
    const insertCall = calls()[0];
    assert.ok(insertCall, "should have made an insert fetch call");
    const headers = insertCall.init?.headers as Record<string, string> | undefined;
    assert.ok(headers?.["authorization"]?.startsWith("Bearer "), "insert should use Bearer token");
  });

  it("timeout (clock exhausted) → returns null (Gemini fallback)", async () => {
    // Clock: starts at 0, jumps past POLL_BUDGET_MS (10000) after the insert so the while loop
    // condition fails immediately on the first check after the insert.
    // The insert happens BEFORE the while loop starts, so we jump the clock BEFORE the deadline
    // is calculated — deadline = clock() + 10000. We need clock to start at 0, then after insert
    // (but before the while check) jump to a value such that deadline has already passed.
    // Simplest: clock always returns a high value, so deadline = highMs + 10000, then the
    // while condition `clock() < deadline` is checked: highMs < highMs + 10000 = true for one
    // iteration, then we need clock to return > deadline.
    //
    // Better approach: start clock at 0, jump to a high value when polled the second time.
    // deadline = 0 + 10000 = 10000; after first sleep+poll cycle, clock returns 20000 > 10000.
    let clockCalls = 0;
    const clockFn = (): number => {
      clockCalls += 1;
      // First call (when deadline is set): return 0 → deadline = 10000.
      // Second call (while condition check after sleep): return 20000 > 10000 → exit loop.
      return clockCalls <= 1 ? 0 : 20_000;
    };
    // Poll response: still pending (clock will expire after one check)
    const { fetch: fakeFetch } = makeFakeFetch([
      { ok: true, body: { ok: true, id: "test-id" } }, // insert
      { ok: true, body: [{ status: "pending", answer: null, provider: null, error: null, answered_at: null, expires_at: new Date(Date.now() + 120_000).toISOString() }] }, // poll → pending
    ]);
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch, clockFn);
    const answer = await infer!("timeout test", undefined);
    assert.equal(answer, null, "budget exhausted → null → Gemini fallback");
  });

  it("insert returns non-ok → returns null (Gemini fallback)", async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { ok: false, body: { ok: false, error: "db error" }, status: 502 },
    ]);
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch);
    const answer = await infer!("some request", undefined);
    assert.equal(answer, null, "non-ok insert → null → Gemini fallback");
  });

  it("insert returns ok:false body → returns null", async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { ok: true, body: { ok: false, error: "secret detected" } },
    ]);
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch);
    const answer = await infer!("some request", undefined);
    assert.equal(answer, null, "ok:false body → null → Gemini fallback");
  });

  it("expired status → returns null (Gemini fallback)", async () => {
    const { fetch: fakeFetch } = makeFakeFetch([
      { ok: true, body: { ok: true, id: "test-id" } }, // insert
      { ok: true, body: [{ status: "expired", answer: null, provider: null, error: "ttl", answered_at: null, expires_at: new Date().toISOString() }] }, // poll
    ]);
    let clockMs = 0;
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch, () => clockMs);
    const answer = await infer!("expired test", undefined);
    assert.equal(answer, null, "expired status → null → Gemini fallback");
  });

  it("malformed answer (missing output) → returns null (Gemini fallback)", async () => {
    const badResult = { ...makeValidResult(), output: null, success: true };
    const { fetch: fakeFetch } = makeFakeFetch([
      { ok: true, body: { ok: true, id: "test-id" } }, // insert
      { ok: true, body: [{ status: "answered", answer: badResult, provider: "claude-max", error: null, answered_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120_000).toISOString() }] }, // poll
    ]);
    let clockMs = 0;
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch, () => clockMs);
    const answer = await infer!("malformed test", undefined);
    assert.equal(answer, null, "malformed answer → null → Gemini fallback");
  });

  it("poll non-ok response → keeps polling until budget, returns null", async () => {
    // Clock: starts at 0 (deadline = 10000), then returns 20000 on second check → exits loop.
    let clockCalls = 0;
    const clockFn = (): number => {
      clockCalls += 1;
      return clockCalls <= 1 ? 0 : 20_000;
    };
    let callIdx = 0;
    const fakeFetchWithBudget = async (url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
      callIdx += 1;
      if (callIdx === 1) {
        return new Response(JSON.stringify({ ok: true, id: "test-id" }), { status: 200, headers: { "content-type": "application/json" } });
      }
      // Polls fail with non-ok
      return new Response(JSON.stringify({ error: "rpc failed" }), { status: 502, headers: { "content-type": "application/json" } });
    };
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetchWithBudget as unknown as typeof fetch, clockFn);
    const answer = await infer!("poll failure test", undefined);
    assert.equal(answer, null, "poll failures → budget exhausted → null → Gemini fallback");
  });

  it("redactedRequest is forwarded as-is (orchestrator already redacted before calling infer)", async () => {
    const result = makeValidResult();
    const { fetch: fakeFetch, calls } = makeFakeFetch([
      { ok: true, body: { ok: true, id: "test-id" } },
      { ok: true, body: [{ status: "answered", answer: result, provider: "claude-max", error: null, answered_at: new Date().toISOString(), expires_at: new Date(Date.now() + 120_000).toISOString() }] },
    ]);
    const infer = buildRelayAskInfer(RELAY_ENV, fakeFetch, () => 0);
    await infer!("already redacted request [REDACTED]", undefined);
    const insertBody = JSON.parse((calls()[0]?.init?.body as string) ?? "{}") as { insert?: { redacted_request?: string } };
    assert.equal(
      insertBody.insert?.redacted_request,
      "already redacted request [REDACTED]",
      "relay forwards redacted_request verbatim (not re-redacted)",
    );
  });
});

// ── runAskRelayOnce tests ─────────────────────────────────────────────────────

describe("runAskRelayOnce", () => {
  it("HARTOS_ASK_RELAY not set → [] (disarmed no-op)", async () => {
    const lines = await runAskRelayOnce({}, new Date().toISOString());
    assert.deepEqual(lines, [], "disarmed → no-op → empty log lines");
  });

  it("HARTOS_ASK_RELAY=off → [] (disarmed)", async () => {
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "off" }, new Date().toISOString());
    assert.deepEqual(lines, []);
  });

  it("HARTOS_ASK_RELAY=true (wrong value) → [] (only 'on' arms it)", async () => {
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "true" }, new Date().toISOString());
    assert.deepEqual(lines, []);
  });

  it("armed + no pending rows → [] (quiet no-op)", async () => {
    const deps: AskRelayDeps = {
      queryPending: async () => [],
      writeAnswer: async () => {},
      runInfer: async () => null,
      expireStale: async () => {},
    };
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps);
    assert.deepEqual(lines, [], "no pending rows → quiet no-op");
  });

  it("armed + injected DB + injected infer → writes an answer", async () => {
    const result = makeValidResult();
    const written: Array<{ id: string; answer: LlmResult | null; error: string | null }> = [];
    const deps: AskRelayDeps = {
      queryPending: async () => [{ id: "row-1", redacted_request: "what should I do?", context: { intent: "daily_brief" } }],
      writeAnswer: async (id, answer, error) => { written.push({ id, answer, error }); },
      runInfer: async () => result,
      expireStale: async () => {},
    };
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps);
    assert.equal(written.length, 1, "should write one answer");
    assert.equal(written[0]!.id, "row-1");
    assert.ok(written[0]!.answer !== null, "answer should not be null on success");
    assert.equal(written[0]!.answer!.provider, "claude-max");
    assert.equal(written[0]!.error, null, "no error on success");
    assert.ok(lines.some((l) => l.includes("answered")), "log should indicate answered");
  });

  it("armed + infer returns null → writes error (not answer)", async () => {
    const written: Array<{ id: string; answer: LlmResult | null; error: string | null }> = [];
    const deps: AskRelayDeps = {
      queryPending: async () => [{ id: "row-2", redacted_request: "test request", context: null }],
      writeAnswer: async (id, answer, error) => { written.push({ id, answer, error }); },
      runInfer: async () => null,
      expireStale: async () => {},
    };
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps);
    assert.equal(written.length, 1);
    assert.equal(written[0]!.answer, null);
    assert.ok(typeof written[0]!.error === "string" && written[0]!.error!.length > 0, "error message should be set");
    assert.ok(lines.some((l) => l.includes("error")), "log should indicate error");
  });

  it("armed + infer returns result with secret in answer → rejects + error written", async () => {
    // Construct a result whose serialized form contains a secret-looking string.
    // The output validator also secret-scans fields, so a secret in the summary field will
    // fail validation before our explicit containsSecret check — either path results in
    // answer=null + a non-null error string. We test the invariant (answer=null, error set)
    // rather than the exact error message, since the path depends on validator ordering.
    //
    // Use a JWT-like string that both the validator (badSummary → containsSecret) and our
    // explicit containsSecret check would catch.
    const secretResult = makeValidResult({
      output: {
        ...VALID_OUTPUT,
        // A raw JWT-like token that containsSecret detects
        summary: "Here is my answer eyJhbGciOiJIUzI1NiJ9.secretpart.aGVsbG8gd29ybGQ answer",
      },
    });
    const written: Array<{ id: string; answer: LlmResult | null; error: string | null }> = [];
    const deps: AskRelayDeps = {
      queryPending: async () => [{ id: "row-secret", redacted_request: "some question", context: null }],
      writeAnswer: async (id, answer, error) => { written.push({ id, answer, error }); },
      runInfer: async () => secretResult,
      expireStale: async () => {},
    };
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps);
    assert.equal(written.length, 1);
    assert.equal(written[0]!.answer, null, "secret in answer → answer not persisted");
    // Error is set either by validateLlmOutput (secret in summary → "Invalid string field: summary")
    // or by our containsSecret check ("secret detected in answer"). Either way it is a non-null string.
    assert.ok(typeof written[0]!.error === "string" && written[0]!.error!.length > 0,
      "error string should be set when answer contains a secret");
    assert.ok(lines.some((l) => l.includes("error")), "log should indicate error");
  });

  it("armed + infer throws → error written, does not throw", async () => {
    const written: Array<{ id: string; answer: LlmResult | null; error: string | null }> = [];
    const deps: AskRelayDeps = {
      queryPending: async () => [{ id: "row-throw", redacted_request: "crash test", context: null }],
      writeAnswer: async (id, answer, error) => { written.push({ id, answer, error }); },
      runInfer: async () => { throw new Error("provider exploded"); },
      expireStale: async () => {},
    };
    // Must not throw
    const lines = await runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps);
    assert.equal(written.length, 1);
    assert.equal(written[0]!.answer, null);
    assert.ok(typeof written[0]!.error === "string", "error string should be set");
    // Error message must be redacted (no raw secret patterns leaked)
    assert.ok(!written[0]!.error!.includes("Bearer "), "error must not contain raw secret pattern");
  });

  it("armed + writeAnswer throws → does not propagate (never throws)", async () => {
    const deps: AskRelayDeps = {
      queryPending: async () => [{ id: "row-write-fail", redacted_request: "write fail test", context: null }],
      writeAnswer: async () => { throw new Error("db write failed"); },
      runInfer: async () => makeValidResult(),
      expireStale: async () => {},
    };
    // Should not throw even when writeAnswer throws
    await assert.doesNotReject(
      () => runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps),
      "writeAnswer throwing must not propagate from runAskRelayOnce",
    );
  });

  it("expireStale throws → does not propagate (best-effort)", async () => {
    const deps: AskRelayDeps = {
      queryPending: async () => [],
      writeAnswer: async () => {},
      runInfer: async () => null,
      expireStale: async () => { throw new Error("expiry DB error"); },
    };
    await assert.doesNotReject(
      () => runAskRelayOnce({ HARTOS_ASK_RELAY: "on" }, new Date().toISOString(), deps),
      "expireStale throwing must not propagate",
    );
  });
});
