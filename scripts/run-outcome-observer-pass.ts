/**
 * scripts/run-outcome-observer-pass.ts — the OUTCOME OBSERVER pass (daemon sub-pass).
 *
 * The closed learning loop's measuring half, run by the daemon (not just the scheduled pulse). Each
 * pass takes a fresh READ-ONLY Wolverine audit, builds currentSubjects from its repairQueue
 * (ids + titles), and calls the SHARED recordDecisionOutcomes (one implementation, also used by
 * autopilot step 5c) to score every recently-EXECUTED targeted proposal as resolved/persisted and
 * append the verdicts to public.cockpit_decision_outcomes. So the cockpit_decision_outcomes table
 * finally gets written between scheduled pulses.
 *
 * Honest by construction: no spine DB → an honest skip line; the (gated) outcomes table absent →
 * an honest no-op line; nothing fabricated. The audit is purely advisory + read-only here. Never
 * persists a fix or mutates anything but the append-only outcomes log.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/run-outcome-observer-pass.js
 */
import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { recordDecisionOutcomes } from "../src/learning/record-decision-outcomes.js";
import { redact } from "../src/llm/redaction.js";
import type { GitFacts } from "../src/wolverine/wolverine-types.js";

type Env = Record<string, string | undefined>;

/**
 * Gather read-only git facts (branch / uncommitted / untracked / ahead) — pure inspection, mutates
 * nothing. Mirrors the wolverine organ adapter so the audit's git-hygiene detector has evidence;
 * undefined when not a git repo / git unavailable (the detector then honestly reports "not assessed").
 */
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
  const uncommitted = lines.length - untracked;
  let ahead: number | null = null;
  let hasUpstream = false;
  const a = git("rev-list --count @{u}..HEAD");
  if (a !== null && /^\d+$/.test(a)) {
    ahead = Number(a);
    hasUpstream = true;
  }
  return { branch, uncommitted, untracked, ahead, hasUpstream };
}

/**
 * Run one outcome-observer pass. No spine DB → honest skip. Never throws (a failed learn must not
 * fail the daemon — the caller also error-isolates). Returns honest log lines: the count written +
 * a per-outcome tally (or an honest no-op / table-missing line).
 */
export async function runOutcomeObserverOnce(env: Env, now: string): Promise<string[]> {
  const db = createCockpitProposalDb(env as NodeJS.ProcessEnv);
  if (!db) return ["outcome-observer: no spine DB (HARTOS_SUPABASE_DB_URL) — skipped"];
  try {
    // Fresh, READ-ONLY audit → the LATER observation. currentSubjects = the repair queue's
    // ids + titles, the loose subjects the shared scorer compares each executed proposal against.
    const audit = wolverineAudit({
      now,
      env: env as Record<string, string | undefined>,
      git: gatherGitFacts(process.cwd()),
    });
    const currentSubjects = audit.repairQueue.flatMap((f) => [f.id, f.title]);

    // result.summary already carries the honest no-op / table-missing / count+tally wording.
    const result = await recordDecisionOutcomes(db, currentSubjects, now);
    return [`outcome-observer: ${result.summary}`];
  } catch (e) {
    return [`outcome-observer pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  } finally {
    await db.close();
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────
const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runOutcomeObserverOnce(process.env, new Date().toISOString())
    .then((lines) => {
      console.log("\nHartOS — outcome observer pass (closed learning loop · append-only)\n");
      for (const l of lines) console.log(`  • ${l}`);
      console.log("");
    })
    .catch((err) => {
      console.error(`outcome-observer-pass failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
