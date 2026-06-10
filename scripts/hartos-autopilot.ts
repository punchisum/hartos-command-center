/**
 * scripts/hartos-autopilot.ts — the HartOS AUTOPILOT PULSE (the organism's heartbeat).
 *
 * ONE command that runs the full autonomous cycle, propose-only + per-action-gated:
 *   1. SENSE    — Wolverine audit (env/git/vault/capability scouts) → verdict + repair queue
 *   2. REMEMBER — executive-memory capture (flag-gated; dry heartbeat otherwise)
 *   3. FORESEE  — Prophet forecast over the audit + memory + capability scouts
 *   4. RECORD   — file the Wolverine audit note to the vault (gated writer)
 *   5. ACT      — run Hart-APPROVED agent jobs from the spine (the runner; per-action gates hold)
 *   6. REPORT   — one honest pulse summary
 *
 * Schedule this daily (like the memory heartbeat) and HartOS senses, remembers, foresees, records,
 * and acts on approved work autonomously — while every mutation stays behind Hart's approval +
 * the per-action env gates. The autopilot never approves anything itself.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/hartos-autopilot.js
 */

import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { forecast, summarizeForecast } from "../src/prophet/forecast.js";
import { readCapabilityScouts } from "../src/beezulbub/scout-vault-reader.js";
import { wolverineAuditNote } from "../src/obsidian/obsidian-from-wolverine.js";
import { writeObsidianNote } from "../src/obsidian/obsidian-writer.js";
import { executiveMemory, type MemorySnapshot } from "../src/awareness/executive-memory.js";
import { createCockpitMemoryDb } from "../src/awareness/supabase-memory-db.js";
import { runMemoryCapture } from "./cockpit-memory-capture.js";
import { runWolverinePropose } from "./wolverine-propose.js";
import { runJobRunner } from "./hartos-runner.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { buildPulseRunRow } from "../src/cockpit/pulse/pulse-run-spine.js";
import { synthesizeDecisions } from "../src/cockpit/decision-synthesis.js";
import { redact } from "../src/llm/redaction.js";
import type { GitFacts } from "../src/wolverine/wolverine-types.js";
import type { WolverineReport } from "../src/wolverine/wolverine-types.js";
import type { ForecastReport } from "../src/prophet/forecast.js";

/**
 * Persist this pulse to the cockpit_pulse_runs spine so the cockpit can show a Last-Pulse tile and
 * score forecast accuracy. Insert-only via the elevated pg URL; honest message when not configured;
 * never throws (a failed log must not fail the pulse).
 */
async function recordPulseRun(
  env: Record<string, string | undefined>,
  now: string,
  audit: WolverineReport,
  fcast: ForecastReport,
  summaryLine: string,
): Promise<string> {
  const handle = createCockpitProposalDb(env);
  if (!handle) return "pulse not recorded (proposal spine not configured — set HARTOS_SUPABASE_DB_URL)";
  try {
    const row = buildPulseRunRow({
      at: now,
      verdict: audit.verdict,
      forecastVerdict: fcast.verdict,
      summary: summaryLine,
      findingCount: audit.findingCount,
      consequenceSubjects: fcast.consequences.map((c) => c.subject),
      payload: {
        topRisks: audit.topRisks.slice(0, 3).map((r) => ({ severity: r.severity, title: r.title })),
        consequences: fcast.consequences.slice(0, 5).map((c) => ({ subject: c.subject, severity: c.severity })),
      },
    });
    await handle.query(
      `insert into public.cockpit_pulse_runs (at, verdict, forecast_verdict, summary, finding_count, consequence_subjects, payload)
         values ($1, $2, $3, $4, $5, $6, $7)`,
      [row.at, row.verdict, row.forecast_verdict, row.summary, row.finding_count, row.consequence_subjects, JSON.stringify(row.payload)],
    );
    return "recorded to cockpit_pulse_runs (feeds the Last-Pulse tile + forecast scoring)";
  } catch (e) {
    return `pulse not recorded: ${redact(e instanceof Error ? e.message : String(e))}`;
  } finally {
    await handle.close();
  }
}

function gatherGitFacts(cwd: string): GitFacts | undefined {
  const git = (args: string): string | null => {
    try {
      return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const branch = git("rev-parse --abbrev-ref HEAD");
  if (branch === null) return undefined;
  const porcelain = git("status --porcelain");
  const lines = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const ahead = git("rev-list --count @{u}..HEAD");
  return { branch, untracked, uncommitted: lines.length - untracked, ahead: ahead && /^\d+$/.test(ahead) ? Number(ahead) : null, hasUpstream: ahead !== null };
}

export async function runAutopilot(env: Record<string, string | undefined>, now: string): Promise<string[]> {
  const out: string[] = [];
  const push = (s = "") => out.push(s);
  push(`HartOS Autopilot pulse — ${now}`);
  push("(propose-only; mutations stay behind Hart's approval + per-action gates)\n");

  // 1. SENSE — Wolverine audit.
  const capabilityScouts = await readCapabilityScouts(env.HARTOS_OBSIDIAN_VAULT_PATH);
  const audit = wolverineAudit({ now, env, git: gatherGitFacts(process.cwd()), capabilityScouts });
  push(`1 SENSE    Wolverine: ${audit.verdict} — ${audit.verdictReason} (${audit.findingCount} finding(s))`);
  for (const f of audit.topRisks.slice(0, 3)) push(`           ! [${f.severity}] ${f.title}`);

  // 1b. PROPOSE — Wolverine writes fixable findings into the cockpit spine as GATED FixProposals
  //     (pending_approval). This turns the pulse from "observes problems" into "queues fixes to
  //     Hart's phone". It NEVER executes — Hart approves in Approvals; the gated executor mutates.
  const proposed = await runWolverinePropose(env, now);
  const proposeHeadline =
    proposed.lines.find((l) => /now in the cockpit|No fixable findings|not configured/i.test(l))?.trim() ??
    proposed.lines[proposed.lines.length - 1]?.trim() ??
    "ran";
  push(`1b PROPOSE Wolverine→cockpit: ${proposeHeadline}`);

  // 2. REMEMBER — memory capture (its own flag decides; dry heartbeat otherwise).
  const mem = await runMemoryCapture(env, now);
  push(`2 REMEMBER ${mem.lines.slice(-2).join(" · ").trim()}`);

  // 3. FORESEE — Prophet over the audit + durable memory + scouts.
  let history: MemorySnapshot[] = [];
  const memHandle = createCockpitMemoryDb(env);
  if (memHandle) {
    try {
      history = await memHandle.store.read();
    } catch {
      history = [];
    } finally {
      await memHandle.close();
    }
  }
  const memory = history.length ? executiveMemory(history, { now }) : null;
  const fcast = forecast({ now, wolverine: audit, memory, capabilityScouts });
  push(`3 FORESEE  ${summarizeForecast(fcast)}`);
  for (const c of fcast.consequences.slice(0, 3)) push(`           → ${c.subject}: ${c.projection.slice(0, 110)}`);

  // 4. RECORD — file the audit note (gated writer; honest skip when disarmed).
  const note = await writeObsidianNote(wolverineAuditNote(audit, now), env);
  push(`4 RECORD   audit note: ${note.written ? `FILED → ${note.relPath}` : note.reason}`);

  // 5. ACT — run Hart-approved agent jobs (the runner; approval floor + per-action gates hold).
  const ran = await runJobRunner(env, now, 3);
  push(`5 ACT      ${ran[0] ?? ""}`);
  for (const l of ran.slice(1)) push(`           ${l}`);

  // 6. LOG — persist this pulse (Last-Pulse tile + forecast-accuracy scoring).
  const pulseLine = `${audit.verdict} · forecast ${fcast.verdict} · ${audit.findingCount} finding(s)`;
  const recorded = await recordPulseRun(env, now, audit, fcast, pulseLine);
  push(`6 LOG      ${recorded}`);

  // 7. REPORT — lead with the Chief-of-Staff decision synthesis (forecast + memory fused).
  const decisions = synthesizeDecisions({ now, forecast: fcast, memory: memory ?? undefined }, { max: 3 });
  if (decisions.status === "ok") push(`\n${decisions.headline}`);
  push(`\nPulse complete. Approve pending work in the cockpit; the next pulse executes it.`);
  return out;
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runAutopilot(process.env, new Date().toISOString())
    .then((lines) => {
      console.log("");
      for (const l of lines) console.log(l);
      console.log("");
    })
    .catch((e) => {
      console.error(`autopilot failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
