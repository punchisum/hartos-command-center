/**
 * scripts/cockpit-memory-capture.ts — the Executive Memory heartbeat (Live Graduation Step 2b).
 *
 * The one Node-side action that makes the memory loop REAL: it builds the current
 * Strategic Brief from the LIVE hosted read-models (the same data the deployed cockpit
 * renders), projects a compact snapshot, and folds it into the durable Supabase store —
 * under the flag + the compactness policy. A host runs this on a daily cadence; the
 * cockpit then reads the accumulated snapshots via the anon RPC and shows real memory.
 *
 * Safety / honesty (all enforced by the libraries this only orchestrates):
 *   - FLAG-GATED + default OFF: nothing is captured unless HARTOS_MEMORY_CAPTURE=true.
 *     With the flag off it still READS the store and reports the count (a dry heartbeat).
 *   - HONEST: only an `ok` brief is worth remembering; an insufficient-evidence brief is
 *     skipped (we never persist "we knew nothing").
 *   - Read-shaped write: reads the store + one policied list write. No provider mutation,
 *     no execution path. The secret is the DB URL (read from env, never printed).
 *
 *   node --env-file-if-exists=.env.local dist/scripts/cockpit-memory-capture.js
 */

import { pathToFileURL } from "node:url";
import { resolveHostedCockpitState } from "../src/runtime/cloudflare-live-read-models.js";
import { strategicAwareness } from "../src/awareness/strategic-awareness.js";
import { captureSnapshot, MEMORY_CAPTURE_FLAG } from "../src/awareness/memory-capture.js";
import { createCockpitMemoryDb, MEMORY_SPINE_DB_URL_ENV } from "../src/awareness/supabase-memory-db.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { redact } from "../src/llm/redaction.js";
import type { DecisionRecord } from "../src/awareness/executive-memory.js";

export interface MemoryCaptureCliResult {
  exitCode: number;
  lines: string[];
}

/**
 * Read recently-EXECUTED spine proposals as DecisionRecords so the snapshot carries Hart's actual
 * decisions — this lights up Executive Memory's causal half (deriveLessons / the "Tracked decisions"
 * view), which was inert because nothing ever supplied decisions. Honest about the unknown: the
 * OUTCOME is left null (we record that a decision was executed, not yet how it turned out). Pure
 * read; resilient — any error yields an empty list (capture proceeds without decisions).
 */
export async function collectRecentExecutedDecisions(
  env: Record<string, string | undefined>,
  now: string,
  limit = 8,
): Promise<DecisionRecord[]> {
  const handle = createCockpitProposalDb(env);
  if (!handle) return [];
  try {
    const res = await handle.query(
      `select id, title, domain, action_type, updated_at from public.cockpit_proposals
         where status = 'executed' order by updated_at desc nulls last limit $1`,
      [limit],
    );
    return (res.rows as Array<Record<string, unknown>>).map((r) => {
      const at = r["updated_at"] != null ? new Date(r["updated_at"] as string) : null;
      return {
        decision: String(r["title"] ?? r["id"] ?? "executed proposal"),
        domain: String(r["domain"] ?? "system"),
        at: at && !Number.isNaN(at.getTime()) ? at.toISOString() : now,
        evidence: `Executed via the cockpit spine (${String(r["action_type"] ?? "proposal")}).`,
        outcome: null,
      };
    });
  } catch {
    return [];
  } finally {
    await handle.close();
  }
}

/**
 * The testable core. Builds the brief from live state and captures it into the env-derived
 * store (or no-ops honestly when the store / read-model env is absent). NEVER throws to the
 * caller — any error is caught and returned as a safe message + non-zero exit. No secret value
 * is ever placed in `lines`.
 */
export async function runMemoryCapture(
  env: Record<string, string | undefined>,
  now: string,
): Promise<MemoryCaptureCliResult> {
  const lines: string[] = [];
  const flagOn = String(env[MEMORY_CAPTURE_FLAG] ?? "").trim().toLowerCase() === "true";
  lines.push("HartOS — Executive Memory heartbeat");
  lines.push(`  ${MEMORY_CAPTURE_FLAG} = ${flagOn ? "true (ARMED — will capture)" : "off (dry heartbeat — reads + reports only, no write)"}`);

  // 1) Build the brief from the LIVE hosted read-models (same source as the deployed cockpit).
  let state;
  try {
    state = await resolveHostedCockpitState(env, { now });
  } catch (e) {
    lines.push(`Could not resolve live read-models: ${redact(e instanceof Error ? e.message : String(e))}`);
    return { exitCode: 1, lines };
  }
  if (!state) {
    lines.push("No hosted read-model env configured (set HARTOS_FITNESS_/OPS_ SUPABASE_URL + READONLY_KEY) — cannot build a brief.");
    return { exitCode: 0, lines };
  }

  const brief = strategicAwareness({ now, panels: state.panels ?? [], proposals: state.proposalQueue ?? [] });
  lines.push(
    `  brief status: ${brief.status}` +
      (brief.status === "ok"
        ? ` (${brief.risks.length} risk / ${brief.drift.length} drift / ${brief.opportunities.length} opp / ${brief.blindSpots.length} blind)`
        : ""),
  );

  // 2) Open the durable store (or honest "not configured").
  const handle = createCockpitMemoryDb(env);
  if (!handle) {
    lines.push(`Memory store not configured (set ${MEMORY_SPINE_DB_URL_ENV}) — nothing persisted.`);
    return { exitCode: 0, lines };
  }
  lines.push(`  store TLS: ${handle.tlsMode}`);

  // 3) Capture (flag-gated). captureSnapshot reads the store first, so `total` is reported
  //    even on a dry/skip heartbeat. When armed, attach Hart's recently-executed decisions so
  //    memory carries cause (decisions) alongside effect (the brief), feeding causal lessons.
  try {
    const decisions = flagOn ? await collectRecentExecutedDecisions(env, now) : [];
    if (decisions.length) lines.push(`  decisions attached: ${decisions.length} recently-executed proposal(s)`);
    const result = await captureSnapshot({ store: handle.store, brief, now, env, decisions });
    lines.push(`  ${result.captured ? "CAPTURED" : "skipped"}: ${result.reason}`);
    lines.push(`  snapshots in store: ${result.total}`);
    lines.push(
      result.total >= 3
        ? "  Executive Memory has ≥3 snapshots — patterns/trends/lessons can be earned."
        : `  Need ≥3 distinct-day snapshots to leave INSUFFICIENT_HISTORY (have ${result.total}).`,
    );
    return { exitCode: 0, lines };
  } catch (e) {
    lines.push(`Capture failed (nothing persisted past the error): ${redact(e instanceof Error ? e.message : String(e))}`);
    return { exitCode: 1, lines };
  } finally {
    await handle.close();
  }
}

// ── Thin bin wrapper: only when run directly. Prints lines, sets the exit code, never throws. ──
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runMemoryCapture(process.env, new Date().toISOString())
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      console.error(`memory-capture: unexpected error: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
