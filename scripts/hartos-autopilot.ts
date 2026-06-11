/**
 * scripts/hartos-autopilot.ts — the HartOS AUTOPILOT PULSE (the organism's heartbeat).
 *
 * ONE command that runs the full autonomous cycle, propose-only BY DEFAULT + per-action-gated:
 *   1.  SENSE    — Wolverine audit (env/git/vault/capability scouts) → verdict + repair queue
 *   1b. PROPOSE  — Wolverine writes fixable findings into the spine as gated FixProposals
 *   2.  REMEMBER — executive-memory capture (flag-gated; dry heartbeat otherwise)
 *   3.  FORESEE  — Prophet forecast over the audit + memory + capability scouts
 *   4.  RECORD   — file the Wolverine audit note to the vault (gated writer)
 *   5.  ACT      — run Hart-APPROVED agent jobs from the spine (the runner; per-action gates hold)
 *   5b. ACT-EXEC — GUARDRAILED autoheal: auto-approve + execute the armed autoheal CLASS only
 *                  (internal, reversible queue hygiene; triple-gated; disarmed by default)
 *   5c. LEARN    — score whether executed proposals resolved their target (closed learning loop)
 *   6.  LOG      — persist this pulse (Last-Pulse tile + forecast-accuracy scoring)
 *   7.  REPORT   — one honest pulse summary
 *
 * Schedule this daily (like the memory heartbeat) and HartOS senses, remembers, foresees, records,
 * and acts on approved work autonomously. Every EXTERNAL mutation stays behind Hart's approval +
 * the per-action env gates: the autopilot approves nothing itself EXCEPT within an explicitly-armed
 * autoheal class (internal, reversible, triple-gated by ALLOW_AUTOHEAL_* + ALLOW_EXEC_* + the
 * kill-switch). With no class armed (the default) it is strictly propose-only, as before.
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
import { runAutoheal } from "./run-autoheal.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { buildPulseRunRow, type PulseRun } from "../src/cockpit/pulse/pulse-run-spine.js";
import { synthesizeDecisions } from "../src/cockpit/decision-synthesis.js";
import { scoreForecastAccuracy, type ForecastAccuracy } from "../src/prophet/forecast-accuracy.js";
import { classifyExecutedOutcomes, type ExecutedTarget } from "../src/learning/outcome-scoring.js";
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

/**
 * LEARN — the closed loop's measuring half. For each recently-EXECUTED proposal that targeted a
 * finding, compare its target against the subjects still present in THIS pulse's audit and append
 * one observation (resolved/persisted) to cockpit_decision_outcomes. Honest no-op when the spine or
 * the (gated, not-yet-applied) outcomes table is absent; never throws (a failed learn must not fail
 * the pulse). This is the EFFECT half executive-memory never had.
 */
async function recordDecisionOutcomes(
  env: Record<string, string | undefined>,
  audit: WolverineReport,
): Promise<string> {
  const handle = createCockpitProposalDb(env);
  if (!handle) return "outcomes not recorded (proposal spine not configured)";
  try {
    const res = await handle.query(
      `select id, payload from public.cockpit_proposals where status='executed' and updated_at > now() - interval '14 days' order by updated_at desc limit 100`,
      [],
    );
    const rows = res.rows as Array<{ id: string; payload: unknown }>;
    const executed: ExecutedTarget[] = [];
    for (const r of rows) {
      const p = (r.payload && typeof r.payload === "object" ? r.payload : {}) as Record<string, unknown>;
      const subject = typeof p.targetId === "string" && p.targetId ? p.targetId : typeof p.targetName === "string" ? p.targetName : "";
      if (!subject) continue; // only finding-targeting proposals carry a measurable subject
      executed.push({ proposalId: r.id, actionType: typeof p.actionType === "string" ? p.actionType : "unknown", subject });
    }
    if (executed.length === 0) return "no recently-executed targeted proposals to score";

    const currentSubjects = audit.repairQueue.flatMap((f) => [f.id, f.title]);
    const scored = classifyExecutedOutcomes(executed, currentSubjects);
    let written = 0;
    try {
      for (const s of scored) {
        await handle.query(
          `insert into public.cockpit_decision_outcomes (proposal_id, action_type, subject, outcome) values ($1,$2,$3,$4)`,
          [s.proposalId, s.actionType, s.subject, s.outcome],
        );
        written += 1;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/cockpit_decision_outcomes|does not exist|42P01/i.test(msg)) {
        return `outcomes table not present — apply 2026061100000000_cockpit_decision_outcomes.sql (scored ${scored.length}, wrote 0)`;
      }
      return `outcomes partial: ${redact(msg)} (wrote ${written})`;
    }
    const resolved = scored.filter((s) => s.outcome === "resolved").length;
    const persisted = scored.filter((s) => s.outcome === "persisted").length;
    return `scored ${scored.length} executed proposal(s): ${resolved} resolved · ${persisted} persisted (wrote ${written})`;
  } catch (e) {
    return `outcomes not recorded: ${redact(e instanceof Error ? e.message : String(e))}`;
  } finally {
    await handle.close();
  }
}

/** Read recent pulse runs and score Prophet's track record (≥2 pulses, else insufficient_history). */
async function readForecastAccuracy(env: Record<string, string | undefined>): Promise<ForecastAccuracy | undefined> {
  const handle = createCockpitProposalDb(env);
  if (!handle) return undefined;
  try {
    const res = await handle.query(`select at, consequence_subjects from public.cockpit_pulse_runs order by at desc limit 30`, []);
    const rows = res.rows as Array<{ at: unknown; consequence_subjects: unknown }>;
    const runs = rows.map((r) => ({
      at: r.at instanceof Date ? r.at.toISOString() : String(r.at ?? ""),
      consequenceSubjects: Array.isArray(r.consequence_subjects) ? (r.consequence_subjects as unknown[]).map(String) : [],
    })) as unknown as PulseRun[];
    return scoreForecastAccuracy(runs);
  } catch {
    return undefined;
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

  // 5b. ACT-EXEC — GUARDRAILED AUTONOMY. Auto-approve + execute ONLY the armed autoheal class
  //     (internal, reversible queue hygiene). Triple-gated: the ALLOW_AUTOHEAL_* class flag AND
  //     each adapter's ALLOW_EXEC_* AND the kill-switch must all hold. It never touches an
  //     external system (no ClickUp store is injected), audits every transition, and reverts
  //     anything it authorizes but does not write. Disarmed by default ⇒ an honest no-op.
  const healed = await runAutoheal(env, new Date(now), 3);
  push(`5b ACT-EXEC ${healed[0] ?? ""}`);
  for (const l of healed.slice(1)) push(`           ${l}`);

  // 5c. LEARN — the closed loop: score whether recently-executed proposals resolved their target
  //     finding (vs persisted), and append the verdicts to cockpit_decision_outcomes. This is the
  //     EFFECT half memory never had; efficacyByActionType later turns it into a track record.
  const learned = await recordDecisionOutcomes(env, audit);
  push(`5c LEARN   ${learned}`);

  // 6. LOG — persist this pulse (Last-Pulse tile + forecast-accuracy scoring).
  const pulseLine = `${audit.verdict} · forecast ${fcast.verdict} · ${audit.findingCount} finding(s)`;
  const recorded = await recordPulseRun(env, now, audit, fcast, pulseLine);
  push(`6 LOG      ${recorded}`);

  // 7. REPORT — lead with the Chief-of-Staff decision synthesis (forecast + memory + the forecast
  //    track record fused). Wiring accuracy in (it was omitted before) closes the loop: decisions
  //    now carry Prophet's measured trust signal, like the cockpit render does.
  const accuracy = await readForecastAccuracy(env);
  const decisions = synthesizeDecisions({ now, forecast: fcast, memory: memory ?? undefined, accuracy }, { max: 3 });
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
