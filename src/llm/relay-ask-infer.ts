/**
 * src/llm/relay-ask-infer.ts
 *
 * P-B3 — Worker-safe relay AskInfer (pure fetch, NO node imports).
 *
 * WORKER BOUNDARY: This module must NEVER import node:*, host-gateway.ts,
 * claude-max-provider.ts, or llm-gateway.ts. It is intentionally a pure-fetch
 * module so it enters the Worker bundle safely. All Claude-Max reasoning happens
 * in the DAEMON (scripts/run-ask-relay-pass.ts); this is only the client side.
 *
 * Implements the AskInfer contract (src/llm/ask-llm.ts):
 *   (redactedRequest, context?) => Promise<LlmResult | null>
 *
 * When HARTOS_ASK_VIA_RELAY === "true":
 *   1. POST the redacted_request + context to the relay-ask Edge Function
 *      (→ inserts an ask_requests row, returns { ok, id }).
 *   2. Short-poll the hartos_get_ask_request RPC every ~600ms, up to ~10s.
 *   3. On status='answered': parse the answer jsonb as LlmResult, return it.
 *   4. On timeout / any error / non-ok response: return null.
 *      → composeAskAnswer falls back to existing Gemini buildAskInfer (never hard-fails).
 *
 * Flag off (HARTOS_ASK_VIA_RELAY !== "true"): buildRelayAskInfer returns undefined,
 * and the worker falls back to the today's buildAskInfer (Gemini path).
 *
 * No new dependencies. Uses globalThis.fetch (available in both workerd + nodejs_compat).
 */

import type { AskInfer } from "./ask-llm.js";
import type { LlmResult } from "./llm-types.js";

/** Env keys used by the relay client. Values never logged or returned. */
const ENV_RELAY_URL = "HARTOS_ASK_RELAY_URL";
const ENV_RELAY_TOKEN = "HARTOS_ASK_WRITE_TOKEN";
const ENV_RELAY_READ_URL = "HARTOS_FITNESS_SUPABASE_URL";
const ENV_RELAY_READ_KEY = "HARTOS_FITNESS_SUPABASE_READONLY_KEY";
const ENV_VIA_RELAY = "HARTOS_ASK_VIA_RELAY";

/** Poll interval: ~600ms per cycle. */
const POLL_INTERVAL_MS = 600;
/** Total budget: ~10s (covers ~1.5s daemon cadence + ~3-15s Claude-Max). */
const POLL_BUDGET_MS = 10_000;

type Env = Record<string, string | undefined>;

/** Injectable fetch type (for tests). */
export type FetchImpl = typeof fetch;

/**
 * Build the relay AskInfer.
 *
 * Returns an AskInfer when the relay flag is on and the required env vars are
 * present; returns undefined when the flag is off (caller uses today's path).
 *
 * @param env       Worker env (or injected for tests).
 * @param fetchImpl Optional fetch override (tests inject a fake). Defaults to globalThis.fetch.
 * @param nowMs     Optional clock override for tests (milliseconds).
 */
export function buildRelayAskInfer(
  env: Env,
  fetchImpl?: FetchImpl,
  nowMs?: () => number,
): AskInfer | undefined {
  // Flag gate: off → return undefined so the caller uses today's Gemini path.
  if (String(env[ENV_VIA_RELAY] ?? "").trim() !== "true") {
    return undefined;
  }

  const relayUrl = (env[ENV_RELAY_URL] ?? "").trim();
  const relayToken = (env[ENV_RELAY_TOKEN] ?? "").trim();
  const readUrl = (env[ENV_RELAY_READ_URL] ?? "").trim();
  const readKey = (env[ENV_RELAY_READ_KEY] ?? "").trim();

  // If any required config is missing, relay is unavailable → return undefined → Gemini fallback.
  if (!relayUrl || !relayToken || !readUrl || !readKey) {
    return undefined;
  }

  const doFetch = fetchImpl ?? globalThis.fetch.bind(globalThis);
  const clock = nowMs ?? (() => Date.now());

  return async (redactedRequest: string, context?: Record<string, unknown>): Promise<LlmResult | null> => {
    // Generate a unique id for this relay request.
    const id = crypto.randomUUID();

    // Step 1: POST to the relay-ask Edge Function to insert the row.
    try {
      const insertRes = await doFetch(relayUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${relayToken}`,
        },
        body: JSON.stringify({
          insert: {
            id,
            redacted_request: redactedRequest,
            ...(context !== undefined ? { context } : {}),
          },
        }),
      });

      if (!insertRes.ok) {
        // Write failed → return null → orchestrator falls back to Gemini.
        return null;
      }

      const insertBody = (await insertRes.json().catch(() => ({}))) as { ok?: boolean };
      if (!insertBody.ok) {
        return null;
      }
    } catch {
      // Network error on insert → null → Gemini fallback.
      return null;
    }

    // Step 2: Short-poll the read-by-id RPC until answered or budget exhausted.
    const deadline = clock() + POLL_BUDGET_MS;

    while (clock() < deadline) {
      // Wait before polling (give the daemon time to pick it up).
      await sleep(POLL_INTERVAL_MS);

      try {
        const pollRes = await doFetch(
          `${readUrl}/rest/v1/rpc/hartos_get_ask_request`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              apikey: readKey,
              authorization: `Bearer ${readKey}`,
              accept: "application/json",
            },
            body: JSON.stringify({ p_id: id }),
          },
        );

        if (!pollRes.ok) {
          // RPC call failed — keep polling until budget expires.
          continue;
        }

        const pollRows = (await pollRes.json().catch(() => [])) as unknown[];
        const row = Array.isArray(pollRows) ? (pollRows[0] ?? null) : null;

        if (!row || typeof row !== "object") continue;
        const r = row as Record<string, unknown>;

        const status = typeof r["status"] === "string" ? r["status"] : "";

        if (status === "answered") {
          // Step 3: Parse and return the answer.
          const answer = r["answer"];
          if (!answer || typeof answer !== "object") {
            // Malformed answer → null → Gemini fallback.
            return null;
          }
          // The answer column stores the full LlmResult JSON.
          const result = answer as LlmResult;
          // Basic shape check (success flag + output object).
          if (result.success !== true || !result.output || typeof result.output !== "object") {
            return null;
          }
          return result;
        }

        if (status === "expired") {
          // Row expired before the daemon answered — null → Gemini fallback.
          return null;
        }

        // status === 'pending' → keep polling.
      } catch {
        // Poll fetch threw — keep polling until budget expires.
      }
    }

    // Budget exhausted → null → orchestrator falls back to Gemini.
    return null;
  };
}

/** Minimal promise-based sleep. Works in both workerd and Node (no node:timers import needed). */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
