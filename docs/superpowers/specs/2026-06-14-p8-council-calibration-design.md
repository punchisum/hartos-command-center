# P8 — Reflexive Learning Loop · Council-Calibration slice (Design)

**Date:** 2026-06-14
**Status:** Approved design — ready for implementation planning
**Series:** P8 (Era 7). Follows P7 "the Council". Slice 1 of the reflexive learning loop.

---

## Goal

Close the reflexive loop: let HartOS consume its **own** track record (Hart's approve/reject on
council proposals) to recalibrate a council decision constant **through the proven §6 self-mod
gauntlet**, so future council confidence is presented more honestly — which in turn reshapes what
Hart sees and approves.

One line: *approvals → (band → approval-rate) aggregate → recalibrate one constant via §6 → more
honest council confidence → better approvals.* Closed loop.

## Non-goals (v1 scope cut)

- **Action-efficacy signal** (`cockpit_decision_outcomes` → proposer severity/confidence thresholds)
  is **slice 2**, explicitly out of scope here.
- No new execution surface. P8 only **reads** the track record and **enqueues** a self-mod task the
  existing gauntlet already governs. It never patches, builds, deploys, or mutates anything itself.
- No change to the council synthesis core (`synthesize()` stays a pure no-laundering MIN at the
  source). Calibration is a separate, demote-only presentation layer.

---

## Architecture

Five units. Two pure (aggregate + decide), one new constant file (the learned knob), one host pass
(glue), one cockpit surfacing line. Everything dangerous is **reused** from P6 self-mod.

```
Hart approves/rejects council proposals  (cockpit_proposals, domain='council')
            │
            ▼
[1] council-calibration-aggregate.ts  (PURE)   ── reads decided council rows,
            │                                       reuses councilRunMemoryEntry() →
            │                                       (panelKey, confidence, hartDecision)
            │                                       grouped by band → {observed rate, sample}
            ▼
[2] council-calibration-decide.ts     (PURE)   ── per band: if sample≥MIN and
            │                                       |observed−current|≥DEADBAND, step prior
            │                                       toward observed by ≤STEP; else no-op.
            │                                       emits a surgical SelfModTask.description
            ▼
[3] ~/.hartos-self-mod-queue.json     (enqueue) ── { selfModClass:"recalibrate", description }
            │
            ▼
   EXISTING §6 self-mod pass (P6)              ── W3 hand patches src/council/council-calibration.ts
            │                                       → scope-guard → build → full suite green →
            │                                       1 file / small delta → AUTO-APPLY (within cap)
            │                                       larger → PROPOSE. Failed post-deploy → auto-revert.
            ▼
[0] src/council/council-calibration.ts (the knob) ── COUNCIL_BAND_APPROVAL updated
            │
            ▼
   createCouncilProposal attaches calibratedConfidence (DEMOTE-ONLY) ── next council run is
                                                                        more honestly conservative
```

### Unit 0 — the learned knob: `src/council/council-calibration.ts` (NEW)

The single constant P8 rewrites, plus the pure function that applies it.

```ts
import type { Confidence } from "./council-types.js";

/**
 * Empirical approval priors per confidence band — the fraction of DECIDED council
 * proposals at this stated band that Hart APPROVED. Seeded neutral (0.50).
 * P8 recalibrates these three literals via the §6 self-mod gauntlet.
 */
export const COUNCIL_BAND_APPROVAL: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.5,
  high: 0.5,
};

/** A band whose empirical approval falls below this is demoted one step when presented. */
export const COUNCIL_DEMOTE_BELOW = 0.5;

const DEMOTE_ONE_STEP: Record<Confidence, Confidence> = {
  high: "medium",
  medium: "low",
  low: "low", // floor — never below low
};

/**
 * DEMOTE-ONLY calibration. Returns a band no HIGHER than `raw`. Preserves §19
 * no-laundering: calibration may only make the council MORE conservative.
 * PURE — never throws.
 */
export function calibrateConfidence(
  raw: Confidence,
  priors: Record<Confidence, number> = COUNCIL_BAND_APPROVAL,
): Confidence {
  if (raw !== "low" && (priors[raw] ?? 0.5) < COUNCIL_DEMOTE_BELOW) {
    return DEMOTE_ONE_STEP[raw];
  }
  return raw;
}
```

**Why demote-only is the load-bearing invariant:** the council's raw confidence already obeys §19
(min of non-degraded specialist bands). Calibration is allowed to *lower* the presented band when
history shows that band is over-trusted, but it can **never raise** it. So the loop can only ever
make HartOS more cautious about itself — it cannot learn to be overconfident.

### Unit 1 — the aggregator: `src/learning/council-calibration-aggregate.ts` (NEW, PURE)

```ts
import type { Confidence } from "../council/council-types.js";
import type { CouncilDecision } from "../council/council-memory.js";

export interface BandStat {
  band: Confidence;
  decided: number;     // approved + rejected (pending excluded)
  approved: number;
  approvalRate: number; // approved / decided, or 0.5 if decided === 0
}

export interface CalibrationAggregate {
  byBand: Record<Confidence, BandStat>;
  totalDecided: number;
}

/** Input: one record per council run, already mapped from a persisted proposal row. */
export interface CouncilRunRecord {
  confidence: Confidence;     // the RAW stated band from the payload
  decision: CouncilDecision;  // approved | rejected | pending
}

/** PURE — group decided runs by band, compute approval rate. Pending excluded. Never throws. */
export function aggregateCalibration(records: CouncilRunRecord[]): CalibrationAggregate;
```

- Pending runs are **excluded** from `decided` — undecided is not signal.
- `approvalRate` for a band with zero decided runs is the neutral `0.5` (so decide() no-ops it).
- The caller (the pass) builds `CouncilRunRecord[]` by querying `cockpit_proposals` (domain=`council`)
  and mapping `status` → `decision`:
  `simulated_approved → approved`, `rejected → rejected`, everything else → `pending`. The raw
  `confidence` comes straight from the persisted `payload.confidence` (confirmed present, see
  Integration §B).

### Unit 2 — the decision: `src/learning/council-calibration-decide.ts` (NEW, PURE)

```ts
export interface CalibrationTuning {
  minSample: number;   // min decided runs in a band before we touch it
  deadband: number;    // min |observed − current| to bother
  step: number;        // max move toward observed per run
}

/** RESPONSIVE defaults (Hart-approved 2026-06-14). */
export const DEFAULT_TUNING: CalibrationTuning = { minSample: 4, deadband: 0.05, step: 0.2 };

export interface BandDelta {
  band: Confidence;
  from: number;        // current prior (rounded to 2dp)
  to: number;          // proposed prior (rounded to 2dp)
  decided: number;
  approvalRate: number;
}

export interface CalibrationDecision {
  deltas: BandDelta[];            // empty ⇒ no-op (honest)
  description: string | null;    // surgical SelfModTask.description, or null when deltas empty
}

/**
 * PURE. For each band: if decided ≥ minSample AND |observed − current| ≥ deadband,
 * move the prior toward observed by at most `step`, rounded to 2dp. Else leave it.
 * Build a deterministic, surgical description naming the file, the symbol, and each
 * old→new literal. Never throws.
 */
export function decideCalibration(
  current: Record<Confidence, number>,
  aggregate: CalibrationAggregate,
  tuning?: CalibrationTuning,
): CalibrationDecision;
```

**The description is deterministic and surgical** — it gives the W3 hand near-zero latitude:

```
Recalibrate council confidence priors in src/council/council-calibration.ts.
Change ONLY the numeric literals inside the COUNCIL_BAND_APPROVAL object:
  - set high: 0.5  → 0.42
  - set medium: 0.5 → 0.58
Do not modify COUNCIL_DEMOTE_BELOW, calibrateConfidence, any other file, or any
other line. Rationale: over 19 decided council runs, HIGH-band proposals were
approved 38% of the time and MEDIUM 61%.
```

### Unit 3 — the host pass: `scripts/run-p8-calibrate-pass.ts` (NEW)

Mirrors the council-pass template exactly (disarmed→`[]`, insufficient-sample→`[]`, try/catch
never throws, returns `string[]` log lines).

```ts
export async function runP8CalibrateOnce(env: Env, now: Date): Promise<string[]> {
  if (!learningArmedFromEnv(env)) return [];              // HARTOS_ALLOW_LEARNING gate (separate)
  try {
    const handle = createCockpitProposalDb(env);
    if (!handle) return [];                               // no DB → silent no-op
    try {
      const rows = await handle.query(
        `select status, payload from public.cockpit_proposals where domain = $1`, ["council"]);
      const records = mapRowsToRecords(rows.rows);        // status→decision, payload.confidence→band
      const aggregate = aggregateCalibration(records);
      if (aggregate.totalDecided < DEFAULT_TUNING.minSample) {
        return [`p8 · insufficient sample (${aggregate.totalDecided} decided) — no-op`];
      }
      const decision = decideCalibration(COUNCIL_BAND_APPROVAL, aggregate, DEFAULT_TUNING);
      if (!decision.description) return [`p8 · priors within deadband — no-op`];
      enqueueSelfModTask({ selfModClass: "recalibrate", description: decision.description }); // queue write
      return [`p8 · enqueued recalibrate · ${decision.deltas.map(d => `${d.band} ${d.from}->${d.to}`).join(", ")}`];
    } finally {
      await handle.close();
    }
  } catch (e) {
    return [`p8 calibrate pass error: ${redact(String(e instanceof Error ? e.message : e))}`];
  }
}
```

`enqueueSelfModTask` appends to `~/.hartos-self-mod-queue.json` (the same FIFO queue
`nextSelfModTask()` already pops). A small new helper beside the queue reader; idempotent-ish via a
de-dupe guard (don't enqueue an identical pending description twice in a row).

**Arming — two independent locks, both Hart's, both default off:**
1. `HARTOS_ALLOW_LEARNING=true` — gates whether P8 computes + **enqueues** at all.
2. The self-mod triple (`HARTOS_SELFMOD_AMENDMENT_APPROVED` + `HARTOS_ALLOW_SELF_MOD` +
   kill-switch off) — independently gates whether the enqueued change ever **applies**.

So with `HARTOS_ALLOW_LEARNING` on but self-mod disarmed, P8 enqueues and the task simply waits —
nothing changes until Hart also arms self-mod. Kill-switch dominates both.

**Live-runner wiring** (`scripts/run-live-runner.ts`): add `const P8_EVERY = 720;` (~1h at the 5s
base poll) and the standard guarded block:

```ts
if (cycle % P8_EVERY === 0) {
  try {
    const p8 = await runP8CalibrateOnce(process.env, new Date(now));
    for (const l of p8) console.log(`[live-runner] ${l}`);
  } catch (e) {
    console.error(`[live-runner] p8 pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
  }
}
```

### Unit 4 — cockpit surfacing (read-only)

Attach `calibratedConfidence` to the council proposal payload in `createCouncilProposal` (raw
`confidence` preserved untouched for audit), and render a one-line calibration note in the existing
council view, e.g.:

> *Council HIGH calls: approved 42% over 19 decided runs → presenting **HIGH as MEDIUM**.*

This makes the loop's reasoning visible without any new route or write path. `calibratedConfidence`
is **derived for presentation only** in v1; it never overwrites the §19 raw band and changes no
approval gate (council stays propose-only).

---

## Integration contracts (verified against the codebase)

**A. Self-mod gauntlet (reused, ready):**
- `SelfModTask = { selfModClass: "fix"|"recalibrate"|"extend"; description: string }`
  (`src/execution/self-mod-pass.ts`). The class is **caller-set at enqueue**; the W3 hand turns the
  `description` into the patch. P8 sets `selfModClass: "recalibrate"`.
- Queue: `~/.hartos-self-mod-queue.json` (`selfModQueuePath()`), FIFO via `nextSelfModTask()`
  (`scripts/run-self-mod-pass.ts`). P8 appends to it.
- Tiering: `classifyTier()` (`src/execution/self-mod-classifier.ts`) — `recalibrate` within
  `SELF_MOD_MAX_FILES=5` / `SELF_MOD_MAX_LINES=150` ⇒ **auto-apply**; over cap ⇒ propose-only.
- Scope guard: `isInSelfModScope()` (`src/execution/self-mod-scope-guard.ts`) — `src/council/...`
  is in-scope and NOT in `SELF_PROTECTED_PREFIXES`, so editing `council-calibration.ts` **passes**.
  (Guardrails, doctrine, self-mod machinery, adapters, secrets, wrangler config are all forbidden —
  none of which P8 touches.)
- Arming: `selfModArmingFromEnv()` AND-gate (`src/execution/self-mod-default-ports.ts`,
  `src/doctrine/amendment-gate.ts`). Unchanged.

**B. Council track record (reused, ready):**
- `createCouncilProposal` (`src/council/council-proposal.ts`) persists the full
  `{ rootGoal, recommendation, confidence, tree, llmCallsUsed }` payload into `cockpit_proposals`
  (JSONB). `payload.confidence` and `tree.panel` are recoverable. ✔
- Decision from `status`: `simulated_approved` → approved, `rejected` → rejected, else pending
  (`src/cockpit/proposals/proposal-queue.ts`, `proposal-types.ts`).
- Read API: `createCockpitProposalDb(env)` → `ProposalDbHandle.query(sql, params)`
  (`src/cockpit/proposals/supabase-proposal-db.ts`) — raw server-side SELECT of the JSONB payload.
- `councilRunMemoryEntry(payload, decision, at)` (`src/council/council-memory.ts`) — reused to
  extract the `(panelKey, confidence, hartDecision)` learning signal. Already pure + tested.

**C. Live-runner pattern (ready):** add a cadence const + guarded `runP8CalibrateOnce()` block,
identical shape to the existing council/self-mod blocks (`scripts/run-live-runner.ts`).

---

## Doctrine compliance

- **§19 no-laundering:** calibration is **demote-only** — it can never present a band higher than the
  raw §19 floor. The synthesis core is untouched.
- **§6 self-mod:** P8 produces a `recalibrate`-class change to its **own `src/` runtime** through the
  ratified gauntlet — exactly the class §6 authorizes for in-cap auto-apply. It never edits its own
  guardrails (scope-guard enforced). Failed post-deploy auto-reverts + disarms. Kill-switch dominates.
- **Propose-only / fail-closed:** P8 adds no execution surface; it writes a queue file. Disarmed by
  default behind `HARTOS_ALLOW_LEARNING`. Thin data ⇒ honest no-op. Pure units never throw.

## Tuning (Hart-approved 2026-06-14 — "Responsive")

`MIN_SAMPLE = 4` decided runs/band · `DEADBAND = 0.05` · `STEP ≤ 0.20` per run. Reacts to the
approval pattern within a handful of decisions; the bounded step still prevents single-outlier
whipsaw, and the §6 gauntlet (suite-green + auto-revert) backstops any bad edit.

## Test strategy

- `council-calibration.ts`: `calibrateConfidence` is demote-only across all 3 bands × prior ranges;
  never returns a higher band; `low` floors.
- `council-calibration-aggregate.ts`: pending excluded; zero-decided → 0.5; correct rates; never throws
  on malformed records.
- `council-calibration-decide.ts`: no-op under minSample; no-op inside deadband; bounded step; 2dp
  rounding; deterministic surgical description string; empty deltas → null description.
- pass: disarmed → `[]`; no DB → `[]`; insufficient sample → no-op line; within-deadband → no-op line;
  well-evidenced delta → one enqueue + correct queue file contents; error path returns a redacted line,
  never throws.
- An end-to-end (mocked queue + in-memory proposal rows) asserting a known approval history produces
  the expected enqueued `recalibrate` description.

## Rollout

1. Land units 0–4 disarmed (suite green). 2. Verify the council view renders `calibratedConfidence`
with neutral priors (no behavioral change at 0.50). 3. Arm `HARTOS_ALLOW_LEARNING` once enough
decided council runs exist; watch P8 enqueue a recalibrate task (self-mod still disarmed ⇒ it waits).
4. When Hart is ready, arm the self-mod triple and let one real recalibration ride the gauntlet.

🤖 Designed with [Claude Code](https://claude.com/claude-code)
