// scripts/run-p8-calibrate-pass.ts
/**
 * scripts/run-p8-calibrate-pass.ts — P8: the council-calibration learning pass (gated, DISARMED).
 *
 * runP8CalibrateOnce(env, now):
 *   - DISARMED → silent [] (HARTOS_ALLOW_LEARNING off / kill-switch on).
 *   - No proposal DB → silent [].
 *   - Insufficient decided sample → honest no-op line.
 *   - Priors within deadband → honest no-op line.
 *   - A well-evidenced delta → enqueue ONE recalibrate SelfModTask onto the
 *     out-of-repo self-mod queue. The existing §6 gauntlet applies it (and its own
 *     arming triple independently governs whether it ever does).
 *
 * Adds NO execution surface: it reads the council track record and appends to a
 * queue file. NODE EXECUTION HOST ONLY. Never the Worker. Never throws.
 */
import { pathToFileURL } from "node:url";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { learningArmedFromEnv } from "../src/learning/learning-arming.js";
import {
  aggregateCalibration,
  type CouncilRunRecord,
} from "../src/learning/council-calibration-aggregate.js";
import { decideCalibration, DEFAULT_TUNING, type CalibrationTuning } from "../src/learning/council-calibration-decide.js";
import { COUNCIL_BAND_APPROVAL } from "../src/council/council-calibration.js";
import { councilRunMemoryEntry, type CouncilDecision } from "../src/council/council-memory.js";
import { isConfidence, type Confidence } from "../src/council/council-types.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { selfModQueuePath, type QueueFs } from "./run-self-mod-pass.js";
import type { SelfModTask } from "../src/execution/self-mod-pass.js";
import { redact } from "../src/llm/redaction.js";

type Env = Record<string, string | undefined>;

const realQueueFs: QueueFs = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, d) => writeFileSync(p, d, "utf8"),
};

/** Map a council proposal's DB status column → the calibration decision. */
function decisionFromStatus(status: string): CouncilDecision {
  if (status === "simulated_approved") return "approved";
  if (status === "rejected") return "rejected";
  return "pending";
}

/**
 * Map persisted council rows → calibration records. The `payload` column holds the
 * WHOLE ProposalQueueItem, so the raw council confidence is at proposedPayload.confidence;
 * the authoritative decision is the live `status` column (the embedded payload.status is
 * frozen at creation). PURE — never throws; malformed rows degrade to low/pending-safe.
 */
export function mapRowsToRecords(rows: { status?: unknown; payload?: unknown }[]): CouncilRunRecord[] {
  const out: CouncilRunRecord[] = [];
  for (const r of Array.isArray(rows) ? rows : []) {
    const status = typeof r?.status === "string" ? r.status : "";
    const decision = decisionFromStatus(status);

    let item: Record<string, unknown> = {};
    const raw = r?.payload;
    if (raw && typeof raw === "object") item = raw as Record<string, unknown>;
    else if (typeof raw === "string") {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") item = parsed as Record<string, unknown>;
      } catch { /* leave empty */ }
    }
    const proposed =
      item["proposedPayload"] && typeof item["proposedPayload"] === "object"
        ? (item["proposedPayload"] as Record<string, unknown>)
        : item;

    // Reuse the pure council-memory extractor for robustness (panelKey etc. available later).
    const entry = councilRunMemoryEntry(proposed, decision, "");
    const confidence: Confidence = isConfidence(entry.confidence) ? entry.confidence : "low";
    out.push({ confidence, decision });
  }
  return out;
}

/** Append a recalibrate task to the out-of-repo self-mod queue (de-dupe identical trailing description). */
export function enqueueSelfModTask(task: SelfModTask, fs: QueueFs = realQueueFs): void {
  const p = selfModQueuePath();
  let queue: unknown[] = [];
  if (fs.exists(p)) {
    try {
      const parsed = JSON.parse(fs.read(p));
      if (Array.isArray(parsed)) queue = parsed;
    } catch { queue = []; }
  }
  const last = queue[queue.length - 1] as SelfModTask | undefined;
  if (last && typeof last === "object" && last.description === task.description) return; // de-dupe
  queue.push(task);
  fs.write(p, JSON.stringify(queue, null, 2));
}

/** Injectable deps so the core is unit-testable without a DB or disk. */
export interface P8PassDeps {
  queryCouncilRows: () => Promise<{ status?: unknown; payload?: unknown }[]>;
  enqueue: (task: SelfModTask) => void;
  currentPriors: Record<Confidence, number>;
  tuning?: CalibrationTuning;
}

/** Pure-ish core: query → aggregate → decide → maybe enqueue. Never throws. */
export async function runP8CalibrateCore(deps: P8PassDeps): Promise<string[]> {
  const tuning = deps.tuning ?? DEFAULT_TUNING;
  try {
    const rows = await deps.queryCouncilRows();
    const records = mapRowsToRecords(rows);
    const aggregate = aggregateCalibration(records);

    if (aggregate.totalDecided < tuning.minSample) {
      return [`p8 · insufficient sample (${aggregate.totalDecided} decided) — no-op`];
    }

    const decision = decideCalibration(deps.currentPriors, aggregate, tuning);
    if (!decision.description) {
      return [`p8 · priors within deadband (${aggregate.totalDecided} decided) — no-op`];
    }

    deps.enqueue({ selfModClass: "recalibrate", description: decision.description });
    const summary = decision.deltas.map((d) => `${d.band} ${d.from}->${d.to}`).join(", ");
    return [`p8 · enqueued recalibrate · ${summary}`];
  } catch (e) {
    return [`p8 calibrate pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  }
}

/**
 * Run one P8 calibration pass. DISARMED → silent []. No DB → silent [].
 * Never throws — errors are caught and returned as a single-element array.
 */
export async function runP8CalibrateOnce(env: Env, now: Date): Promise<string[]> {
  void now;
  if (!learningArmedFromEnv(env)) return [];

  const h = createCockpitProposalDb(env as NodeJS.ProcessEnv);
  if (!h) return [];
  try {
    return await runP8CalibrateCore({
      queryCouncilRows: async () => {
        const r = await h.query(`select status, payload from public.cockpit_proposals where domain = $1`, ["council"]);
        return (r.rows as { status?: unknown; payload?: unknown }[]) ?? [];
      },
      enqueue: (task) => enqueueSelfModTask(task),
      currentPriors: COUNCIL_BAND_APPROVAL,
      tuning: DEFAULT_TUNING,
    });
  } catch (e) {
    return [`p8 calibrate pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  } finally {
    await h.close();
  }
}

// ── CLI entry point ─────────────────────────────────────────────────────────
const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runP8CalibrateOnce(process.env, new Date())
    .then((lines) => { for (const l of lines) console.log(l); })
    .catch((err) => {
      console.error(`p8-calibrate-pass failed: ${redact(err instanceof Error ? err.message : String(err))}`);
      process.exit(1);
    });
}
