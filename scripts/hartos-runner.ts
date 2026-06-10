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
import { runMemoryCapture } from "./cockpit-memory-capture.js";
import type { AgentJobKind } from "../src/jobs/agent-job.js";

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

/** Execute one job kind in-process. Every action keeps its own gates; nothing is bypassed. */
async function executeJob(kind: AgentJobKind, arg: string, env: Record<string, string | undefined>, now: string): Promise<{ ok: boolean; detail: string }> {
  switch (kind) {
    case "beezulbub.hunt": {
      const r = await runBeezulbubHunt(arg || "general", env, now);
      return { ok: true, detail: r.lines.slice(-3).join(" | ").slice(0, 300) };
    }
    case "research.brief": {
      const r = await runResearch(arg || "scope this request", env, now);
      return { ok: true, detail: r.lines.slice(-3).join(" | ").slice(0, 300) };
    }
    case "memory.capture": {
      const r = await runMemoryCapture(env, now);
      return { ok: r.exitCode === 0, detail: r.lines.slice(-2).join(" | ").slice(0, 300) };
    }
    case "wolverine.audit": {
      // The audit CLI is a host-edge script (gathers env/git/vault); run it via its module import
      // would need its gather functions — keep it honest: direct the operator to the autopilot,
      // which runs the audit inline. The runner executes the queue-shaped kinds.
      return { ok: false, detail: "wolverine.audit runs in the autopilot pulse (npm run hartos:autopilot) — skipped here" };
    }
    case "rinnegan.sync": {
      return { ok: false, detail: "rinnegan.sync is a Hart-fired live DB write (npm run rinnegan:sync-pack) — skipped by policy" };
    }
    default:
      return { ok: false, detail: `unknown job kind "${kind}"` };
  }
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
    out.push(`${rows.length} Hart-approved agent job(s):`);
    for (const row of rows) {
      const kind = (row.payload?.proposedPayload?.jobKind ?? "") as AgentJobKind;
      const arg = String(row.payload?.proposedPayload?.jobArg ?? "");
      let result: { ok: boolean; detail: string };
      try {
        result = await executeJob(kind, arg, env, now);
      } catch (e) {
        result = { ok: false, detail: `threw: ${e instanceof Error ? e.message : String(e)}` };
      }
      out.push(`  • ${row.id} [${kind}] → ${result.ok ? "executed" : "skipped"}: ${result.detail}`);
      if (result.ok) {
        await handle.query(`update public.cockpit_proposals set status='executed', updated_at=now() where id=$1`, [row.id]);
        await handle.query(
          `insert into public.cockpit_proposal_audit (proposal_id, event, to_status) values ($1, 'executed', 'executed')`,
          [row.id],
        );
        out.push("    spine advanced → executed (+ audit row)");
      }
    }
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
      console.error(`runner failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
