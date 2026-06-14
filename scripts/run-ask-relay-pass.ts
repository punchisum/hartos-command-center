/**
 * scripts/run-ask-relay-pass.ts
 *
 * P-B2 — Daemon ask-relay sub-pass.
 *
 * `runAskRelayOnce(env, now)`: pulls pending ask_requests rows from the
 * cockpit Supabase project, runs buildHostGateway() (Claude-Max primary,
 * Gemini/OpenAI fallback) on each, and writes the answer (or error) back.
 *
 * GATED: returns [] immediately unless `HARTOS_ASK_RELAY === "on"`.
 * Default = pure no-op. Mirrors the fitness-poll and self-mod gating pattern
 * in run-live-runner.ts.
 *
 * NEVER THROWS: every error is caught, logged (redacted), and the row is
 * marked with `error` + status remains pending (so expiry handles it) or
 * we set status=answered with an error payload. A DB blip never kills the daemon.
 *
 * Wired into run-live-runner.ts on a ~1.5s cadence (ASK_RELAY_EVERY = 1 cycle
 * at 1s cadence, but the relay cadence is a separate setInterval so it does
 * not block the main 5s job poll). See the wiring comment in run-live-runner.ts.
 *
 * Security:
 *   - Secret-scan (containsSecret) runs on the answer JSON before writing back.
 *   - The request is already redacted by the Worker (§16); the daemon does NOT
 *     re-process or re-send the original request — it uses redacted_request as-is.
 *   - `buildHostGateway(env)` is HOST-ONLY (imports node:child_process via
 *     claude-max-provider); it is NEVER imported by the Worker bundle.
 *   - The daemon's answer write uses the pg connection (HARTOS_SUPABASE_DB_URL),
 *     NOT the Worker's anon key.
 *
 * RPC contract: rows are read via a direct SQL query on the pool connection.
 * The read-by-id RPC (hartos_get_ask_request) is for the Worker's anon key only.
 */

import { buildHostGateway } from "../src/llm/host-gateway.js";
import { validateLlmOutput } from "../src/llm/output-validator.js";
import { containsSecret, redact } from "../src/llm/redaction.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import type { LlmResult } from "../src/llm/llm-types.js";

type Env = NodeJS.ProcessEnv | Record<string, string | undefined>;

/** A pending ask_request row as read from the DB. */
interface PendingAskRow {
  id: string;
  redacted_request: string;
  context: unknown;
}

/** Injected dependencies (for testing without network/DB). */
export interface AskRelayDeps {
  /** Query function — reads pending rows from ask_requests. */
  queryPending: () => Promise<PendingAskRow[]>;
  /** Write the answer (or error) for one row back to the DB. */
  writeAnswer: (id: string, answer: LlmResult | null, error: string | null) => Promise<void>;
  /** Run the LLM inference for one pending row. */
  runInfer: (redactedRequest: string, context: unknown) => Promise<LlmResult | null>;
  /** Expire stale rows (best-effort). */
  expireStale: () => Promise<void>;
}

/** Max rows processed per pass to keep the daemon light. */
const MAX_ROWS_PER_PASS = 5;

/**
 * Run one ask-relay pass: pull pending rows, run the host gateway, write answers.
 *
 * @param env   Process environment (or injected for tests).
 * @param now   ISO string of the current time (informational, not used for DB ops).
 * @param deps  Optional injected dependencies (tests inject these; production builds them).
 * @returns     Array of log lines (empty array = no-op or nothing to do).
 */
export async function runAskRelayOnce(
  env: Env,
  now: string,
  deps?: Partial<AskRelayDeps>,
): Promise<string[]> {
  // GATED: return immediately unless HARTOS_ASK_RELAY=on.
  if (String(env["HARTOS_ASK_RELAY"] ?? "").trim() !== "on") {
    return [];
  }

  const lines: string[] = [];

  // Build production deps when not injected.
  let queryPending: AskRelayDeps["queryPending"];
  let writeAnswer: AskRelayDeps["writeAnswer"];
  let runInfer: AskRelayDeps["runInfer"];
  let expireStale: AskRelayDeps["expireStale"];
  let dbHandle: ReturnType<typeof createCockpitProposalDb> | null = null;

  if (deps?.queryPending && deps?.writeAnswer && deps?.runInfer && deps?.expireStale) {
    // Test path: all deps injected.
    queryPending = deps.queryPending;
    writeAnswer = deps.writeAnswer;
    runInfer = deps.runInfer;
    expireStale = deps.expireStale;
  } else {
    // Production path: build from env.
    dbHandle = createCockpitProposalDb(env as NodeJS.ProcessEnv);
    if (!dbHandle) {
      lines.push("[ask-relay] HARTOS_SUPABASE_DB_URL not configured — skipping");
      return lines;
    }

    const db = dbHandle;
    queryPending = async () => {
      const result = await db.query(
        `select id, redacted_request, context from public.ask_requests
         where status = 'pending' and expires_at > now()
         order by created_at asc
         limit $1`,
        [MAX_ROWS_PER_PASS],
      );
      return (result.rows as PendingAskRow[]);
    };

    writeAnswer = async (id: string, answer: LlmResult | null, error: string | null) => {
      const answeredAt = new Date().toISOString();
      await db.query(
        `update public.ask_requests
         set status = 'answered',
             answer = $2::jsonb,
             provider = $3,
             error = $4,
             answered_at = $5
         where id = $1`,
        [
          id,
          answer !== null ? JSON.stringify(answer) : null,
          answer?.provider ?? null,
          error,
          answeredAt,
        ],
      );
    };

    runInfer = async (redactedRequest: string, context: unknown) => {
      const gateway = buildHostGateway(env as NodeJS.ProcessEnv);
      const intent =
        context !== null &&
        typeof context === "object" &&
        "intent" in (context as Record<string, unknown>) &&
        typeof (context as Record<string, unknown>)["intent"] === "string"
          ? ((context as Record<string, unknown>)["intent"] as string)
          : "";

      const ctxRecord =
        context !== null && typeof context === "object"
          ? (context as Record<string, unknown>)
          : undefined;

      const result =
        intent === "strategy_review"
          ? await gateway.runStrategyReasoning(redactedRequest, ctxRecord)
          : intent === "build_agent"
            ? await gateway.runCtoReasoning(redactedRequest, ctxRecord)
            : await gateway.classifyAndContextualize(redactedRequest, ctxRecord);

      if (!result || result.success !== true) return null;
      return result;
    };

    expireStale = async () => {
      await db.query(
        `update public.ask_requests set status = 'expired'
         where status in ('pending', 'answered') and expires_at < now()`,
      );
    };
  }

  try {
    // Best-effort: expire stale rows from previous cycles.
    await expireStale().catch((e: unknown) => {
      lines.push(`[ask-relay] expiry failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
    });

    const rows = await queryPending();
    if (!rows.length) {
      // No pending rows — quiet no-op (don't clutter the log).
      return lines;
    }

    lines.push(`[ask-relay] ${rows.length} pending row(s) at ${now}`);

    for (const row of rows) {
      let answer: LlmResult | null = null;
      let errorMsg: string | null = null;

      try {
        // Run the host gateway (Claude-Max primary, Gemini/OpenAI fallback).
        const result = await runInfer(row.redacted_request, row.context);

        if (result === null) {
          errorMsg = "infer returned null (gateway disarmed or all providers failed)";
        } else {
          // Validate the structured output before writing back.
          const validation = validateLlmOutput(result.output);
          if (!validation.ok) {
            errorMsg = `invalid LLM output: ${validation.error ?? "unknown"}`;
          } else {
            // Secret-scan the answer before persisting.
            const answerJson = JSON.stringify(result);
            if (containsSecret(answerJson)) {
              errorMsg = "secret detected in answer — not persisted";
            } else {
              answer = result;
            }
          }
        }
      } catch (e: unknown) {
        errorMsg = redact(String(e instanceof Error ? e.message : e));
      }

      // Write answer (or error) back to the DB.
      try {
        await writeAnswer(row.id, answer, errorMsg);
        if (answer !== null) {
          lines.push(`[ask-relay] id=${row.id} → answered (provider=${answer.provider}, mode=${answer.mode})`);
        } else {
          lines.push(`[ask-relay] id=${row.id} → error: ${errorMsg ?? "unknown"}`);
        }
      } catch (e: unknown) {
        lines.push(
          `[ask-relay] id=${row.id} write failed: ${redact(String(e instanceof Error ? e.message : e))}`,
        );
      }
    }
  } catch (e: unknown) {
    lines.push(`[ask-relay] pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
  } finally {
    // Close the DB connection only when WE opened it (not injected from tests).
    if (dbHandle) {
      await dbHandle.close().catch(() => {});
    }
  }

  return lines;
}
