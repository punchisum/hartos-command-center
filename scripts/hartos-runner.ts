/**
 * scripts/hartos-runner.ts — the AGENT-JOB RUNNER (the autonomy spine's gated hands for jobs).
 *
 * Reads cockpit-approved (simulated_approved) `agent_job` proposals from the Supabase spine and
 * executes each mapped agent action IN-PROCESS — Beezulbub hunt, Wolverine audit (+ vault note),
 * Research brief, memory capture, Rinnegan sync — under that action's OWN env gates (a disarmed
 * gate yields an honest skip; the job stays approved + re-runnable). On success the spine row
 * advances → executed (+ durable audit row), so the cockpit shows the truth.
 *
 * Approval floor: only HART-APPROVED jobs execute. The runner never invents work. These job kinds
 * are read/propose-shaped (scout/audit/brief/capture/sync) — provider MUTATION jobs stay with the
 * separate execute:cockpit-approved spine executor + ALLOW_EXEC_* flags.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/hartos-runner.js [--max 3]
 */

import { pathToFileURL } from "node:url";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { runBeezulbubHunt } from "./beezulbub-hunt.js";
import { runResearch } from "./research-run.js";
import { runReport } from "./report-run.js";
import { runMemoryCapture } from "./cockpit-memory-capture.js";
import { runClaudeTask } from "../src/execution/claude-task-executor.js";
import { isAgentJobKind, sanitizeJobArg, type AgentJobKind } from "../src/jobs/agent-job.js";
import { redact } from "../src/llm/redaction.js";

const COCKPIT_APPROVED_STATUS = "simulated_approved";

interface JobRow {
  id: string;
  payload: { proposedPayload?: { jobKind?: string; jobArg?: string } } & Record<string, unknown>;
}

export interface JobRunResult {
  id: string;
  kind: string;
  outcome: "executed" | "skipped" | "failed";
  detail: string;
}

/**
 * Execute one job kind in-process. Every action keeps its own gates; nothing is bypassed.
 *
 * `terminal: true` marks a STRUCTURAL refusal — a job this runner can never run (it lives in another
 * path). The caller terminalizes such rows (→ failed) instead of reverting them to re-runnable, which
 * is what prevented the 2026-06-14 runaway skip loop. `ok:false` WITHOUT `terminal` is a transient,
 * armable skip (a disarmed gate) — the row stays re-runnable so arming the flag later lets it run.
 */
async function executeJob(kind: AgentJobKind, arg: string, env: Record<string, string | undefined>, now: string): Promise<{ ok: boolean; detail: string; terminal?: boolean }> {
  switch (kind) {
    case "beezulbub.hunt": {
      const r = await runBeezulbubHunt(arg || "general", env, now);
      return { ok: true, detail: r.lines.slice(-3).join(" | ").slice(0, 300) };
    }
    case "research.brief": {
      const r = await runResearch(arg || "scope this request", env, now);
      return { ok: true, detail: r.lines.slice(-3).join(" | ").slice(0, 300) };
    }
    case "claude.execute": {
      // The Claude-CLI execution hand — applies a Hart-approved code change to the repo. Armed by
      // HARTOS_ALLOW_CLAUDE_EXECUTE (default OFF ⇒ honest skip; the job stays approved + re-runnable).
      // Git-reversible (review with `git diff`); code-edit tools only, never Bash.
      return await runClaudeTask(arg, env);
    }
    case "report": {
      // Deterministic HartOS state report; files to the vault when ALLOW_OBSIDIAN_WRITE is armed
      // (an unarmed writer is an honest skip inside runReport — the job still counts as executed).
      const r = await runReport(arg, env, now);
      return { ok: true, detail: r.lines.slice(-2).join(" | ").slice(0, 300) };
    }
    case "memory.capture": {
      const r = await runMemoryCapture(env, now);
      return { ok: r.exitCode === 0, detail: r.lines.slice(-2).join(" | ").slice(0, 300) };
    }
    case "wolverine.audit": {
      // The audit CLI is a host-edge script (gathers env/git/vault); run it via its module import
      // would need its gather functions — keep it honest: direct the operator to the autopilot,
      // which runs the audit inline. The runner executes the queue-shaped kinds.
      return { ok: false, terminal: true, detail: "wolverine.audit runs in the autopilot pulse (npm run hartos:autopilot) — not runnable in this runner; terminalized so it cannot re-loop" };
    }
    case "rinnegan.sync": {
      return { ok: false, terminal: true, detail: "rinnegan.sync is a Hart-fired live DB write (npm run rinnegan:sync-pack) — not runnable in this runner; terminalized so it cannot re-loop" };
    }
    default:
      return { ok: false, terminal: true, detail: `unknown job kind "${kind}"` };
  }
}

/**
 * PURE: decide the spine row's next status + audit event from a job result.
 *   - success                       → executed            (terminal; advances the spine)
 *   - structural refusal (terminal) → failed              (terminal; OUT of the re-runnable set)
 *   - transient skip (armable gate) → simulated_approved  (stays re-runnable on purpose)
 *
 * The `failed` branch is the fix for the runaway skip loop: the runner re-selects only
 * `simulated_approved` rows, so a terminalized row is never picked up again.
 */
export function jobDisposition(result: { ok: boolean; terminal?: boolean }): { newStatus: string; event: "executed" | "skipped" | "failed" } {
  if (result.ok) return { newStatus: "executed", event: "executed" };
  if (result.terminal) return { newStatus: "failed", event: "failed" };
  return { newStatus: COCKPIT_APPROVED_STATUS, event: "skipped" };
}

export async function runJobRunner(env: Record<string, string | undefined>, now: string, max = 3): Promise<string[]> {
  const out: string[] = [];
  const handle = createCockpitProposalDb(env);
  if (!handle) {
    out.push("Proposal spine not configured (set HARTOS_SUPABASE_DB_URL) — no jobs to run.");
    return out;
  }
  try {
    const res = await handle.query(
      `select id, payload from public.cockpit_proposals where status = $1 and payload->>'actionType' = 'agent_job' order by updated_at asc nulls last limit $2`,
      [COCKPIT_APPROVED_STATUS, max],
    );
    const rows = res.rows as JobRow[];
    if (rows.length === 0) {
      out.push("No Hart-approved agent jobs in the spine — nothing to run.");
      return out;
    }

    // Audit EVERY terminal outcome — executed | skipped | failed — not only successes. The runner's
    // promise is that the cockpit shows the truth; a safety system that records only successes
    // launders failure into absence. (Audit table columns: proposal_id, event, to_status.)
    const auditOutcome = async (proposalId: string, event: "executed" | "skipped" | "failed", toStatus: string): Promise<void> => {
      await handle.query(
        `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, $2, $3)`,
        [proposalId, event, toStatus],
      );
    };

    out.push(`${rows.length} Hart-approved agent job(s):`);
    let executed = 0;
    let skipped = 0;
    let failed = 0;
    for (const row of rows) {
      const rawKind = row.payload?.proposedPayload?.jobKind;
      const arg = sanitizeJobArg(row.payload?.proposedPayload?.jobArg);

      // Validate the instruction before the gated hands act on it. An unrecognized kind is a
      // FAILED outcome (audited), never silently dropped by the dispatcher's default.
      if (!isAgentJobKind(rawKind)) {
        failed += 1;
        // Terminalize (→ failed) so an unrecognized kind cannot sit at simulated_approved and be
        // re-selected every poll (the same loop class the wolverine.audit row exhibited).
        await handle.query(
          `update public.cockpit_proposals set status='failed', updated_at=now() where id=$1 and status=$2`,
          [row.id, COCKPIT_APPROVED_STATUS],
        );
        out.push(`  • ${row.id} [${String(rawKind)}] → failed: unrecognized job kind (not in the allowlist) — terminalized`);
        await auditOutcome(row.id, "failed", "failed");
        continue;
      }
      const kind: AgentJobKind = rawKind;

      // CLAIM-BEFORE-RUN (CAS): flip the row → 'executing' while the job actually runs, so the
      // cockpit shows a live "Running" instead of a job silently sitting at approved for minutes.
      // The compare-and-set also keeps the old race guarantee: only the first claimant runs (the
      // autopilot ACT step and a manual runner can read the same simulated_approved rows).
      const claim = await handle.query(
        `update public.cockpit_proposals set status='executing', updated_at=now() where id=$1 and status=$2`,
        [row.id, COCKPIT_APPROVED_STATUS],
      );
      if ((claim.rowCount ?? 0) !== 1) {
        skipped += 1;
        out.push(`  • ${row.id} [${kind}] → already claimed by another runner — skipped (no double audit)`);
        continue;
      }

      let result: { ok: boolean; detail: string };
      try {
        result = await executeJob(kind, arg, env, now);
      } catch (e) {
        result = { ok: false, detail: `threw: ${redact(e instanceof Error ? e.message : String(e))}` };
      }

      // Map the result to a next status + audit event. A successful job advances → executed; a
      // STRUCTURAL refusal terminalizes → failed (out of the re-runnable set, so it cannot re-loop);
      // a transient/armable skip reverts → simulated_approved so arming the gate later runs it.
      const disp = jobDisposition(result);
      await handle.query(
        `update public.cockpit_proposals set status=$2, updated_at=now() where id=$1 and status='executing'`,
        [row.id, disp.newStatus],
      );
      await auditOutcome(row.id, disp.event, disp.newStatus);
      if (disp.event === "executed") {
        executed += 1;
        out.push(`  • ${row.id} [${kind}] → executed: ${result.detail}`);
        out.push("    spine advanced → executed (+ audit row)");
      } else if (disp.event === "failed") {
        failed += 1;
        out.push(`  • ${row.id} [${kind}] → failed (terminal, not re-runnable): ${result.detail}`);
      } else {
        skipped += 1;
        out.push(`  • ${row.id} [${kind}] → skipped (re-runnable): ${result.detail}`);
      }
    }
    out.push(`Summary: ${executed} executed · ${skipped} skipped · ${failed} failed.`);
    return out;
  } finally {
    await handle.close();
  }
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const i = process.argv.indexOf("--max");
  const max = i >= 0 && process.argv[i + 1] ? Math.max(1, Number(process.argv[i + 1]) || 3) : 3;
  runJobRunner(process.env, new Date().toISOString(), max)
    .then((lines) => {
      console.log("\nHartOS — agent-job runner (Hart-approved jobs only; per-action gates hold)\n");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((e) => {
      console.error(`runner failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
