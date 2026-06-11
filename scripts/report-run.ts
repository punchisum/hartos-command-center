/**
 * scripts/report-run.ts — run a HartOS STATE REPORT (deterministic; read-only) and file it.
 *
 * "Run a report" as a real, executable agent job. It gathers HartOS's live state (Wolverine audit
 * + Prophet forecast + Chief-of-Staff decision + executive memory + autonomy posture), renders a
 * human-readable report note, and files it to the vault (gated by ALLOW_OBSIDIAN_WRITE) plus a
 * local reports/ artifact. No LLM, no provider mutation, no fabrication — empty sections mean no
 * signal. The runner executes this for an approved `report` agent job; it can also be run directly:
 *
 *   npm run report:run -- "ops focus"     (or no arg for a general state report)
 */

import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { forecast, summarizeForecast } from "../src/prophet/forecast.js";
import { readCapabilityScouts } from "../src/beezulbub/scout-vault-reader.js";
import { executiveMemory, summarizeMemory, type MemorySnapshot } from "../src/awareness/executive-memory.js";
import { createCockpitMemoryDb } from "../src/awareness/supabase-memory-db.js";
import { synthesizeDecisions } from "../src/cockpit/decision-synthesis.js";
import { writeObsidianNote } from "../src/obsidian/obsidian-writer.js";
import { armedAutohealAdapters } from "../src/doctrine/autoheal-gate.js";
import { buildStateReportNote, reportSlug, type StateReportSections } from "../src/reports/state-report-note.js";
import { redact } from "../src/llm/redaction.js";
import type { GitFacts } from "../src/wolverine/wolverine-types.js";

export interface ReportRunResult {
  lines: string[];
  /** The full report as Markdown (the deliverable). */
  report: string;
  slug: string;
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

function flagArmed(env: Record<string, string | undefined>, flag: string): boolean {
  return String(env[flag] ?? "").trim().toLowerCase() === "true";
}

export async function runReport(focus: string, env: Record<string, string | undefined>, now: string): Promise<ReportRunResult> {
  const out: string[] = [];
  const push = (s = "") => out.push(s);
  const f = (focus ?? "").trim();

  push(`\n=== HartOS report run (deterministic; read-only) ===`);
  push(`Focus: ${f || "(general state report)"}`);

  const capabilityScouts = await readCapabilityScouts(env.HARTOS_OBSIDIAN_VAULT_PATH);
  const audit = wolverineAudit({ now, env, git: gatherGitFacts(process.cwd()), capabilityScouts });

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
  const decisions = synthesizeDecisions({ now, forecast: fcast, memory: memory ?? undefined }, { max: 3 });

  // Autonomy posture — the honest "what is armed right now" the report leads with.
  const armed = [...armedAutohealAdapters(env)];
  const postureLines: string[] = [
    armed.length ? `Autoheal armed (auto-executes): ${armed.join(", ")}` : "Autoheal: none armed (propose-only)",
  ];
  for (const flag of ["ALLOW_OBSIDIAN_WRITE", "HARTOS_MEMORY_CAPTURE", "HARTOS_RESEARCH_GATHER", "BEEZULBUB_ALLOW_NETWORK"]) {
    postureLines.push(`${flag}: ${flagArmed(env, flag) ? "armed" : "off"}`);
  }
  if (String(env.HARTOS_EXECUTION_KILL_SWITCH ?? "").trim().toLowerCase() === "on") {
    postureLines.push("KILL-SWITCH: ON (all execution disabled)");
  }

  const sections: StateReportSections = {
    focus: f,
    verdict: audit.verdict,
    verdictReason: audit.verdictReason,
    findingCount: audit.findingCount,
    topRisks: audit.topRisks.slice(0, 5).map((r) => ({ severity: r.severity, title: r.title, recommendedFix: r.recommendedFix })),
    forecastSummary: summarizeForecast(fcast),
    consequences: fcast.consequences.slice(0, 5).map((c) => ({ subject: c.subject, severity: c.severity, projection: c.projection.slice(0, 160) })),
    decisionsHeadline: decisions.status === "ok" ? decisions.headline : null,
    memorySummary: memory ? summarizeMemory(memory) : "insufficient history (no memory snapshots yet)",
    recurringSubjects: memory ? memory.recurringPatterns.slice(0, 5).map((p) => p.subject) : [],
    postureLines,
  };

  const note = buildStateReportNote(sections, now);
  push(`\nReport: "${note.title}" → ${note.folder}`);
  push(`Verdict ${audit.verdict} · ${audit.findingCount} finding(s) · forecast ${fcast.verdict}`);

  const write = await writeObsidianNote(note, env);
  push(`vault: ${write.written ? `FILED → ${write.relPath}` : write.reason}`);

  return { lines: out, report: note.body, slug: reportSlug(f, now) };
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const focus = process.argv.slice(2).join(" ").trim();
  void (async () => {
    try {
      const now = new Date().toISOString();
      const { lines, report, slug } = await runReport(focus, process.env, now);
      for (const l of lines) console.log(l);

      // Write the full report as a local artifact (NOT the gated vault write) so it can be delivered.
      const { mkdir, writeFile } = await import("node:fs/promises");
      const path = await import("node:path");
      const dir = path.join(process.cwd(), "reports");
      await mkdir(dir, { recursive: true });
      const file = path.join(dir, `${slug}.md`);
      await writeFile(file, report, "utf8");
      console.log(`\nFull report written: ${file}`);
    } catch (e) {
      console.error(`report-run: unexpected error: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    }
  })();
}
