# P8 — Reflexive Learning Loop · Council-Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let HartOS recalibrate one council confidence constant from its own approve/reject track record, through the proven §6 self-mod gauntlet, so future council confidence is presented more honestly (demote-only).

**Architecture:** Two pure modules (aggregate the `band→approval-rate` record; decide a bounded prior delta) feed a host pass that enqueues a surgical `recalibrate` `SelfModTask` onto the existing `~/.hartos-self-mod-queue.json`. The P6 self-mod gauntlet does all patching/building/deploying/reverting. A new constant file `council-calibration.ts` holds the learned priors + a demote-only `calibrateConfidence`; the council proposal adapter attaches a `calibratedConfidence` for the cockpit. Everything is disarmed by default behind a new `HARTOS_ALLOW_LEARNING` gate (independent of the self-mod arming triple).

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node:test` + `node:assert/strict`, `tsc` build (`npm run build`), tests in `tests/*.test.ts` → `dist/tests/*.test.js`.

**Design:** `docs/superpowers/specs/2026-06-14-p8-council-calibration-design.md`

**Parallelism (for subagent-driven execution):** Tasks 1, 2, 4 are independent (no cross-deps) and may run in parallel worktree tracks. Task 3 depends on 1+2. Task 5 depends on 1. Task 6 depends on 1+2+3+4. Task 7 depends on 6. Task 8 last.

---

## File Structure

- **Create** `src/council/council-calibration.ts` — the learned knob: `COUNCIL_BAND_APPROVAL` priors + demote-only `calibrateConfidence`. (Task 1)
- **Create** `src/learning/council-calibration-aggregate.ts` — pure: decided council runs → per-band approval stats. (Task 2)
- **Create** `src/learning/council-calibration-decide.ts` — pure: stats + current priors → bounded delta + surgical self-mod description. (Task 3)
- **Create** `src/learning/learning-arming.ts` — `learningArmedFromEnv` (HARTOS_ALLOW_LEARNING + kill-switch). (Task 4)
- **Modify** `src/council/council-proposal.ts` — attach `calibratedConfidence` to the persisted payload. (Task 5)
- **Modify** `src/cockpit/council-view.ts` — surface `calibratedConfidence` + a calibration note. (Task 5)
- **Create** `scripts/run-p8-calibrate-pass.ts` — `runP8CalibrateOnce` host glue + `enqueueSelfModTask` + `mapRowsToRecords` + `runP8CalibrateCore`. (Task 6)
- **Modify** `scripts/run-live-runner.ts` — wire the P8 pass on a slow cadence. (Task 7)
- **Modify** `docs/BUILD_HISTORY.md`, memory — record the series. (Task 8)
- Tests: `tests/council-calibration.test.ts`, `tests/council-calibration-aggregate.test.ts`, `tests/council-calibration-decide.test.ts`, `tests/learning-arming.test.ts`, `tests/p8-calibrate-pass.test.ts`, plus additions to `tests/council-proposal.test.ts` and `tests/council-view.test.ts`.

**TDD rhythm in this repo (tsc-coupled):** write the test → run `npm run build` and expect a compile error naming the missing export (this is RED) → implement → `npm run build` then run the one test file (GREEN) → commit. The full suite (`node --test "dist/tests/**/*.test.js"`) must stay green at every commit.

---

### Task 1: The learned knob — `council-calibration.ts`

**Files:**
- Create: `src/council/council-calibration.ts`
- Test: `tests/council-calibration.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/council-calibration.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COUNCIL_BAND_APPROVAL,
  COUNCIL_DEMOTE_BELOW,
  calibrateConfidence,
} from "../src/council/council-calibration.js";

describe("calibrateConfidence (demote-only)", () => {
  it("seeded priors are neutral 0.5 for all three bands", () => {
    assert.equal(COUNCIL_BAND_APPROVAL.low, 0.5);
    assert.equal(COUNCIL_BAND_APPROVAL.medium, 0.5);
    assert.equal(COUNCIL_BAND_APPROVAL.high, 0.5);
    assert.equal(COUNCIL_DEMOTE_BELOW, 0.5);
  });

  it("at neutral priors (0.5, not below the floor) nothing is demoted", () => {
    assert.equal(calibrateConfidence("high"), "high");
    assert.equal(calibrateConfidence("medium"), "medium");
    assert.equal(calibrateConfidence("low"), "low");
  });

  it("a band whose prior is BELOW the floor is demoted exactly one step", () => {
    assert.equal(calibrateConfidence("high", { low: 0.5, medium: 0.5, high: 0.4 }), "medium");
    assert.equal(calibrateConfidence("medium", { low: 0.5, medium: 0.4, high: 0.5 }), "low");
  });

  it("low never demotes below low (floor)", () => {
    assert.equal(calibrateConfidence("low", { low: 0.1, medium: 0.5, high: 0.5 }), "low");
  });

  it("NEVER inflates: a high prior on a low band does not promote it (§19 preserved)", () => {
    assert.equal(calibrateConfidence("low", { low: 0.99, medium: 0.99, high: 0.99 }), "low");
    assert.equal(calibrateConfidence("medium", { low: 0.99, medium: 0.99, high: 0.99 }), "medium");
  });

  it("only demotes ONE step even with a very low prior", () => {
    assert.equal(calibrateConfidence("high", { low: 0.5, medium: 0.5, high: 0.01 }), "medium");
  });
});
```

- [ ] **Step 2: Run build to verify RED**

Run: `npm run build`
Expected: tsc error — `Cannot find module '../src/council/council-calibration.js'` / missing exports.

- [ ] **Step 3: Implement**

```ts
// src/council/council-calibration.ts
/**
 * P8 — the learned knob. The empirical approval priors per confidence band and a
 * DEMOTE-ONLY calibration function. P8 rewrites COUNCIL_BAND_APPROVAL's three
 * numeric literals via the §6 self-mod gauntlet. PURE — never throws.
 *
 * Demote-only is the load-bearing invariant: calibration may only present a band
 * LOWER than the §19 raw band, never higher. So the loop can only ever make
 * HartOS more conservative about itself — never overconfident.
 */
import type { Confidence } from "./council-types.js";

/**
 * Empirical approval priors per band — the fraction of DECIDED council proposals at
 * this stated (raw) band that Hart APPROVED. Seeded neutral (0.5). P8 recalibrates
 * these three literals; the self-mod scope guard allows edits to this file.
 */
export const COUNCIL_BAND_APPROVAL: Record<Confidence, number> = {
  low: 0.5,
  medium: 0.5,
  high: 0.5,
};

/** A band whose empirical approval falls strictly below this is demoted one step when presented. */
export const COUNCIL_DEMOTE_BELOW = 0.5;

const DEMOTE_ONE_STEP: Record<Confidence, Confidence> = {
  high: "medium",
  medium: "low",
  low: "low", // floor — never below low
};

/**
 * DEMOTE-ONLY calibration. Returns a band no HIGHER than `raw`.
 * If the raw band's prior is below COUNCIL_DEMOTE_BELOW, present it one step lower.
 * PURE — never throws.
 */
export function calibrateConfidence(
  raw: Confidence,
  priors: Record<Confidence, number> = COUNCIL_BAND_APPROVAL,
): Confidence {
  const prior = typeof priors[raw] === "number" ? priors[raw] : 0.5;
  if (raw !== "low" && prior < COUNCIL_DEMOTE_BELOW) {
    return DEMOTE_ONE_STEP[raw];
  }
  return raw;
}
```

- [ ] **Step 4: Run build + test to verify GREEN**

Run: `npm run build` then `node --test dist/tests/council-calibration.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/council/council-calibration.ts tests/council-calibration.test.ts
git commit -m "feat(p8): council-calibration knob — demote-only calibrateConfidence + seeded priors"
```

---

### Task 2: The aggregator — `council-calibration-aggregate.ts`

**Files:**
- Create: `src/learning/council-calibration-aggregate.ts`
- Test: `tests/council-calibration-aggregate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/council-calibration-aggregate.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateCalibration,
  type CouncilRunRecord,
} from "../src/learning/council-calibration-aggregate.js";

const r = (confidence: "low" | "medium" | "high", decision: "approved" | "rejected" | "pending"): CouncilRunRecord =>
  ({ confidence, decision });

describe("aggregateCalibration", () => {
  it("empty input → all bands neutral 0.5, zero decided", () => {
    const a = aggregateCalibration([]);
    assert.equal(a.totalDecided, 0);
    for (const band of ["low", "medium", "high"] as const) {
      assert.equal(a.byBand[band].decided, 0);
      assert.equal(a.byBand[band].approved, 0);
      assert.equal(a.byBand[band].approvalRate, 0.5);
    }
  });

  it("pending runs are EXCLUDED from decided + rate", () => {
    const a = aggregateCalibration([r("high", "approved"), r("high", "pending"), r("high", "pending")]);
    assert.equal(a.byBand.high.decided, 1);
    assert.equal(a.byBand.high.approved, 1);
    assert.equal(a.byBand.high.approvalRate, 1);
    assert.equal(a.totalDecided, 1);
  });

  it("computes per-band approval rate over decided runs", () => {
    const a = aggregateCalibration([
      r("high", "approved"), r("high", "rejected"), r("high", "rejected"), r("high", "rejected"), // 1/4 = 0.25
      r("medium", "approved"), r("medium", "approved"), r("medium", "rejected"),                  // 2/3 ≈ 0.6667
    ]);
    assert.equal(a.byBand.high.decided, 4);
    assert.equal(a.byBand.high.approvalRate, 0.25);
    assert.equal(a.byBand.medium.decided, 3);
    assert.ok(Math.abs(a.byBand.medium.approvalRate - 2 / 3) < 1e-9);
    assert.equal(a.byBand.low.decided, 0);
    assert.equal(a.byBand.low.approvalRate, 0.5); // untouched neutral
    assert.equal(a.totalDecided, 7);
  });

  it("never throws on a malformed record (defensive)", () => {
    // @ts-expect-error intentionally malformed
    const a = aggregateCalibration([{ confidence: "bogus", decision: "approved" }, null, undefined]);
    assert.ok(a.totalDecided >= 0);
  });
});
```

- [ ] **Step 2: Run build to verify RED**

Run: `npm run build`
Expected: tsc error — missing module `../src/learning/council-calibration-aggregate.js`.

- [ ] **Step 3: Implement**

```ts
// src/learning/council-calibration-aggregate.ts
/**
 * P8 — pure aggregator. Group DECIDED council runs by their raw confidence band and
 * compute the per-band approval rate. Pending runs are excluded (undecided is not
 * signal). PURE — never throws. A band with zero decided runs reports the neutral
 * rate 0.5 so the decide step no-ops it.
 */
import type { Confidence } from "../council/council-types.js";
import { isConfidence } from "../council/council-types.js";
import type { CouncilDecision } from "../council/council-memory.js";

/** One council run, reduced to the two fields calibration needs. */
export interface CouncilRunRecord {
  confidence: Confidence;
  decision: CouncilDecision;
}

export interface BandStat {
  band: Confidence;
  decided: number; // approved + rejected (pending excluded)
  approved: number;
  approvalRate: number; // approved/decided, or 0.5 when decided === 0
}

export interface CalibrationAggregate {
  byBand: Record<Confidence, BandStat>;
  totalDecided: number;
}

const BANDS: Confidence[] = ["low", "medium", "high"];

/** PURE — never throws. Malformed records are skipped. */
export function aggregateCalibration(records: CouncilRunRecord[]): CalibrationAggregate {
  const counts: Record<Confidence, { decided: number; approved: number }> = {
    low: { decided: 0, approved: 0 },
    medium: { decided: 0, approved: 0 },
    high: { decided: 0, approved: 0 },
  };

  const list = Array.isArray(records) ? records : [];
  for (const rec of list) {
    if (!rec || typeof rec !== "object") continue;
    const band = (rec as CouncilRunRecord).confidence;
    const decision = (rec as CouncilRunRecord).decision;
    if (!isConfidence(band)) continue;
    if (decision === "approved") {
      counts[band].decided += 1;
      counts[band].approved += 1;
    } else if (decision === "rejected") {
      counts[band].decided += 1;
    }
    // pending → ignored
  }

  const byBand = {} as Record<Confidence, BandStat>;
  let totalDecided = 0;
  for (const band of BANDS) {
    const { decided, approved } = counts[band];
    totalDecided += decided;
    byBand[band] = {
      band,
      decided,
      approved,
      approvalRate: decided === 0 ? 0.5 : approved / decided,
    };
  }

  return { byBand, totalDecided };
}
```

- [ ] **Step 4: Run build + test to verify GREEN**

Run: `npm run build` then `node --test dist/tests/council-calibration-aggregate.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/learning/council-calibration-aggregate.ts tests/council-calibration-aggregate.test.ts
git commit -m "feat(p8): pure council-calibration aggregator (band -> approval rate, pending excluded)"
```

---

### Task 3: The decision — `council-calibration-decide.ts`

**Files:**
- Create: `src/learning/council-calibration-decide.ts`
- Test: `tests/council-calibration-decide.test.ts`
- Depends on: Task 1 (Confidence), Task 2 (CalibrationAggregate)

- [ ] **Step 1: Write the failing test**

```ts
// tests/council-calibration-decide.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  decideCalibration,
  DEFAULT_TUNING,
} from "../src/learning/council-calibration-decide.js";
import type { CalibrationAggregate, BandStat } from "../src/learning/council-calibration-aggregate.js";
import type { Confidence } from "../src/council/council-types.js";

const NEUTRAL: Record<Confidence, number> = { low: 0.5, medium: 0.5, high: 0.5 };

const agg = (over: Partial<Record<Confidence, Partial<BandStat>>>): CalibrationAggregate => {
  const band = (b: Confidence): BandStat => ({
    band: b, decided: 0, approved: 0, approvalRate: 0.5,
    ...(over[b] ?? {}),
  });
  const byBand = { low: band("low"), medium: band("medium"), high: band("high") };
  const totalDecided = byBand.low.decided + byBand.medium.decided + byBand.high.decided;
  return { byBand, totalDecided };
};

describe("DEFAULT_TUNING (Responsive)", () => {
  it("is minSample 4 / deadband 0.05 / step 0.20", () => {
    assert.deepEqual(DEFAULT_TUNING, { minSample: 4, deadband: 0.05, step: 0.2 });
  });
});

describe("decideCalibration", () => {
  it("no-ops a band below minSample even with a big gap", () => {
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 3, approved: 0, approvalRate: 0 } }), DEFAULT_TUNING);
    assert.deepEqual(d.deltas, []);
    assert.equal(d.description, null);
  });

  it("no-ops a band inside the deadband", () => {
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 10, approved: 5, approvalRate: 0.52 } }), DEFAULT_TUNING);
    assert.deepEqual(d.deltas, []);
    assert.equal(d.description, null);
  });

  it("moves toward observed, bounded by step, when sample + deadband clear", () => {
    // observed 0.0, current 0.5, gap 0.5 > deadband; step 0.2 → 0.30
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 8, approved: 0, approvalRate: 0 } }), DEFAULT_TUNING);
    assert.equal(d.deltas.length, 1);
    assert.equal(d.deltas[0].band, "high");
    assert.equal(d.deltas[0].from, 0.5);
    assert.equal(d.deltas[0].to, 0.3);
    assert.ok(d.description && d.description.includes("council-calibration.ts"));
    assert.ok(d.description!.includes("high: 0.5"));
    assert.ok(d.description!.includes("0.3"));
  });

  it("moves UP toward a high observed rate too (prior tracks reality, not demote-only)", () => {
    // observed 1.0, current 0.5, step 0.2 → 0.70
    const d = decideCalibration(NEUTRAL, agg({ medium: { decided: 6, approved: 6, approvalRate: 1 } }), DEFAULT_TUNING);
    assert.equal(d.deltas[0].band, "medium");
    assert.equal(d.deltas[0].to, 0.7);
  });

  it("when the gap is smaller than step, lands exactly on observed (2dp)", () => {
    // observed 0.4, current 0.5, gap 0.1 < step 0.2 → 0.40
    const d = decideCalibration(NEUTRAL, agg({ high: { decided: 5, approved: 2, approvalRate: 0.4 } }), DEFAULT_TUNING);
    assert.equal(d.deltas[0].to, 0.4);
  });

  it("emits multiple band deltas in one description, others left untouched", () => {
    const d = decideCalibration(
      NEUTRAL,
      agg({
        high: { decided: 8, approved: 0, approvalRate: 0 },
        medium: { decided: 8, approved: 8, approvalRate: 1 },
      }),
      DEFAULT_TUNING,
    );
    assert.equal(d.deltas.length, 2);
    assert.ok(d.description!.includes("high"));
    assert.ok(d.description!.includes("medium"));
    assert.ok(!d.description!.includes("low:")); // unchanged band not mentioned
  });

  it("never throws on a degenerate aggregate", () => {
    // @ts-expect-error degenerate
    const d = decideCalibration(NEUTRAL, { byBand: {}, totalDecided: 0 }, DEFAULT_TUNING);
    assert.deepEqual(d.deltas, []);
  });
});
```

- [ ] **Step 2: Run build to verify RED**

Run: `npm run build`
Expected: tsc error — missing module `../src/learning/council-calibration-decide.js`.

- [ ] **Step 3: Implement**

```ts
// src/learning/council-calibration-decide.ts
/**
 * P8 — pure decision step. Given the current priors and the aggregate, propose a
 * bounded move of each band's prior toward its observed approval rate, but only when
 * the band has enough decided samples and the gap clears the deadband. Build a
 * surgical, deterministic self-mod description that names the file, the symbol, and
 * each old→new literal. Empty deltas ⇒ honest no-op (null description).
 * PURE — never throws.
 */
import type { Confidence } from "../council/council-types.js";
import type { CalibrationAggregate } from "./council-calibration-aggregate.js";

export interface CalibrationTuning {
  minSample: number; // min decided runs in a band before we touch it
  deadband: number; // min |observed − current| to bother
  step: number; // max move toward observed per run
}

/** RESPONSIVE defaults (Hart-approved 2026-06-14). */
export const DEFAULT_TUNING: CalibrationTuning = { minSample: 4, deadband: 0.05, step: 0.2 };

export interface BandDelta {
  band: Confidence;
  from: number; // current prior (2dp)
  to: number; // proposed prior (2dp)
  decided: number;
  approvalRate: number;
}

export interface CalibrationDecision {
  deltas: BandDelta[]; // empty ⇒ no-op
  description: string | null; // surgical SelfModTask.description, or null when deltas empty
}

const BANDS: Confidence[] = ["low", "medium", "high"];
const round2 = (x: number): number => Math.round(x * 100) / 100;

export function decideCalibration(
  current: Record<Confidence, number>,
  aggregate: CalibrationAggregate,
  tuning: CalibrationTuning = DEFAULT_TUNING,
): CalibrationDecision {
  const deltas: BandDelta[] = [];
  const byBand = aggregate && typeof aggregate === "object" ? aggregate.byBand : undefined;

  for (const band of BANDS) {
    const stat = byBand?.[band];
    if (!stat || stat.decided < tuning.minSample) continue;

    const cur = typeof current[band] === "number" ? current[band] : 0.5;
    const observed = stat.approvalRate;
    const gap = observed - cur;
    if (Math.abs(gap) < tuning.deadband) continue;

    // Move toward observed, bounded by step.
    const move = Math.sign(gap) * Math.min(tuning.step, Math.abs(gap));
    const to = round2(cur + move);
    if (to === round2(cur)) continue; // rounding made it a no-op

    deltas.push({ band, from: round2(cur), to, decided: stat.decided, approvalRate: round2(observed) });
  }

  if (deltas.length === 0) return { deltas: [], description: null };

  const setLines = deltas.map((d) => `  - set ${d.band}: ${d.from}  → ${d.to}`).join("\n");
  const rationale = deltas
    .map((d) => `${d.band} approved ${Math.round(d.approvalRate * 100)}% over ${d.decided} decided runs`)
    .join("; ");

  const description =
    `Recalibrate council confidence priors in src/council/council-calibration.ts.\n` +
    `Change ONLY the numeric literals inside the COUNCIL_BAND_APPROVAL object:\n` +
    `${setLines}\n` +
    `Do not modify COUNCIL_DEMOTE_BELOW, calibrateConfidence, any other file, or any other line.\n` +
    `Rationale: ${rationale}.`;

  return { deltas, description };
}
```

- [ ] **Step 4: Run build + test to verify GREEN**

Run: `npm run build` then `node --test dist/tests/council-calibration-decide.test.js`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add src/learning/council-calibration-decide.ts tests/council-calibration-decide.test.ts
git commit -m "feat(p8): pure calibration decision — bounded prior step + surgical self-mod description"
```

---

### Task 4: The learning arming gate — `learning-arming.ts`

**Files:**
- Create: `src/learning/learning-arming.ts`
- Test: `tests/learning-arming.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// tests/learning-arming.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  learningArmedFromEnv,
  LEARNING_ALLOW_ENV,
  LEARNING_KILL_SWITCH_ENV,
} from "../src/learning/learning-arming.js";

describe("learningArmedFromEnv", () => {
  it("disarmed by default (flag absent)", () => {
    assert.equal(learningArmedFromEnv({}), false);
  });
  it("armed only when HARTOS_ALLOW_LEARNING is exactly 'true'", () => {
    assert.equal(learningArmedFromEnv({ [LEARNING_ALLOW_ENV]: "true" }), true);
    assert.equal(learningArmedFromEnv({ [LEARNING_ALLOW_ENV]: "TRUE" }), false);
    assert.equal(learningArmedFromEnv({ [LEARNING_ALLOW_ENV]: "1" }), false);
    assert.equal(learningArmedFromEnv({ [LEARNING_ALLOW_ENV]: " true " }), true); // trimmed
  });
  it("kill-switch ON dominates even when armed", () => {
    assert.equal(
      learningArmedFromEnv({ [LEARNING_ALLOW_ENV]: "true", [LEARNING_KILL_SWITCH_ENV]: "on" }),
      false,
    );
    assert.equal(
      learningArmedFromEnv({ [LEARNING_ALLOW_ENV]: "true", [LEARNING_KILL_SWITCH_ENV]: "ON" }),
      false,
    );
  });
});
```

- [ ] **Step 2: Run build to verify RED**

Run: `npm run build`
Expected: tsc error — missing module `../src/learning/learning-arming.js`.

- [ ] **Step 3: Implement**

```ts
// src/learning/learning-arming.ts
/**
 * P8 — learning arming gate. Fail-closed: P8 computes + enqueues ONLY when
 * HARTOS_ALLOW_LEARNING=true AND the kill-switch is off. This is INDEPENDENT of the
 * self-mod arming triple (amendment + class flag + kill-switch) which separately
 * governs whether any enqueued change ever applies. Mirrors council-arming.ts.
 */
type Env = Record<string, string | undefined>;

export const LEARNING_ALLOW_ENV = "HARTOS_ALLOW_LEARNING";
export const LEARNING_KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";

export function learningArmedFromEnv(env: Env): boolean {
  if ((env[LEARNING_KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on") return false;
  return (env[LEARNING_ALLOW_ENV] ?? "").trim() === "true";
}
```

- [ ] **Step 4: Run build + test to verify GREEN**

Run: `npm run build` then `node --test dist/tests/learning-arming.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/learning/learning-arming.ts tests/learning-arming.test.ts
git commit -m "feat(p8): learning arming gate (HARTOS_ALLOW_LEARNING + kill-switch, fail-closed)"
```

---

### Task 5: Surface calibratedConfidence — proposal payload + council view

**Files:**
- Modify: `src/council/council-proposal.ts` (add `calibratedConfidence` to `proposedPayload` + `afterState`)
- Modify: `src/cockpit/council-view.ts` (read `calibratedConfidence`, add a calibration note)
- Test: extend `tests/council-proposal.test.ts` and `tests/council-view.test.ts`
- Depends on: Task 1

- [ ] **Step 1: Write the failing tests**

Append to `tests/council-proposal.test.ts` (inside the existing top-level `describe`, or as a new `describe` block at the end of the file):

```ts
// tests/council-proposal.test.ts  (append)
import { calibrateConfidence } from "../src/council/council-calibration.js";

describe("createCouncilProposal — calibratedConfidence", () => {
  it("attaches calibratedConfidence (raw preserved) to the persisted payload", async () => {
    const captured: any[] = [];
    const store = { upsert: async (item: any) => { captured.push(item); } };
    const payload = {
      rootGoal: "g",
      recommendation: "do x",
      confidence: "high" as const,
      tree: { goal: { goal: "g" }, panel: ["cto"], findings: [], synthesis: { recommendation: "do x", confidence: "high", consensus: [], dissent: [], truncated: false, notes: [] }, children: [], depth: 1 },
      llmCallsUsed: 3,
    };
    await createCouncilProposal(store, payload as any, new Date("2026-06-14T00:00:00.000Z"));
    const item = captured[0];
    assert.equal(item.proposedPayload.confidence, "high"); // raw preserved
    assert.equal(item.proposedPayload.calibratedConfidence, calibrateConfidence("high")); // attached
  });
});
```

> Note: `createCouncilProposal` is already imported at the top of `tests/council-proposal.test.ts`. If not, add `import { createCouncilProposal } from "../src/council/council-proposal.js";`.

Append to `tests/council-view.test.ts`:

```ts
// tests/council-view.test.ts  (append)
describe("councilViewModel — calibration note", () => {
  it("adds a calibration note when calibratedConfidence is lower than raw", () => {
    const view = councilViewModel({
      rootGoal: "g", recommendation: "r", confidence: "high", calibratedConfidence: "medium",
      llmCallsUsed: 0, tree: { findings: [], synthesis: { consensus: [], dissent: [], truncated: false, notes: [] }, children: [] },
    });
    assert.equal(view.confidence, "high");
    assert.equal(view.calibratedConfidence, "medium");
    assert.ok(view.calibrationNote && /HIGH/i.test(view.calibrationNote) && /MEDIUM/i.test(view.calibrationNote));
  });

  it("no calibration note when calibrated == raw", () => {
    const view = councilViewModel({
      rootGoal: "g", recommendation: "r", confidence: "medium", calibratedConfidence: "medium",
      llmCallsUsed: 0, tree: { findings: [], synthesis: { consensus: [], dissent: [], truncated: false, notes: [] }, children: [] },
    });
    assert.equal(view.calibrationNote, null);
  });

  it("calibratedConfidence falls back to raw confidence when absent (old proposals)", () => {
    const view = councilViewModel({
      rootGoal: "g", recommendation: "r", confidence: "low",
      llmCallsUsed: 0, tree: { findings: [], synthesis: { consensus: [], dissent: [], truncated: false, notes: [] }, children: [] },
    });
    assert.equal(view.calibratedConfidence, "low");
    assert.equal(view.calibrationNote, null);
  });
});
```

> Note: `councilViewModel` is already imported in `tests/council-view.test.ts`.

- [ ] **Step 2: Run build to verify RED**

Run: `npm run build`
Expected: tsc errors — `calibratedConfidence`/`calibrationNote` not on `CouncilViewModel`; `calibratedConfidence` not on the persisted payload.

- [ ] **Step 3: Implement — council-proposal.ts**

In `src/council/council-proposal.ts`, add the import at the top (after the existing imports):

```ts
import { calibrateConfidence } from "./council-calibration.js";
```

Then, inside `createCouncilProposal`, after `const title = ...` (around line 41), compute:

```ts
  // P8: demote-only calibrated band attached for the cockpit. Raw `confidence` is preserved
  // untouched (audit + the band the aggregator measures approval against).
  const calibratedConfidence = calibrateConfidence(payload.confidence);
```

Add `calibratedConfidence` to `proposedPayload`:

```ts
    proposedPayload: {
      rootGoal: payload.rootGoal,
      recommendation: payload.recommendation,
      confidence: payload.confidence,
      calibratedConfidence,
      tree: payload.tree,
      llmCallsUsed: payload.llmCallsUsed,
    },
```

And add it to `afterState` (around line 90):

```ts
    afterState: {
      recommendationPreview: payload.recommendation.slice(0, 500),
      confidence: payload.confidence,
      calibratedConfidence,
    },
```

- [ ] **Step 4: Implement — council-view.ts**

In `src/cockpit/council-view.ts`, add two fields to `CouncilViewModel` (after `confidence: string;`):

```ts
  /** P8 demote-only calibrated band for presentation; falls back to raw confidence when absent. */
  calibratedConfidence: string;
  /** Non-null one-liner only when the calibrated band differs (is lower) than the raw band. */
  calibrationNote: string | null;
```

Add both to the `EMPTY` constant:

```ts
    confidence: "low",
    calibratedConfidence: "low",
    calibrationNote: null,
```

In the main `try` block, after `const confidence = isConfidence(rawConf) ? rawConf : "low";`, derive:

```ts
    const rawCalib = safeStr(p["calibratedConfidence"]);
    const calibratedConfidence = isConfidence(rawCalib) ? rawCalib : confidence;
    const calibrationNote =
      calibratedConfidence !== confidence
        ? `Council ${confidence.toUpperCase()} calls are historically over-trusted — presenting as ${calibratedConfidence.toUpperCase()}.`
        : null;
```

Add both to the returned object (after `confidence,`):

```ts
      confidence,
      calibratedConfidence,
      calibrationNote,
```

And add both to the `catch` fallback return (it spreads `EMPTY`, so `calibratedConfidence`/`calibrationNote` are already covered — no change needed there).

- [ ] **Step 5: Run build + tests to verify GREEN**

Run: `npm run build` then `node --test dist/tests/council-proposal.test.js dist/tests/council-view.test.js`
Expected: PASS (all existing + the new cases).

- [ ] **Step 6: Commit**

```bash
git add src/council/council-proposal.ts src/cockpit/council-view.ts tests/council-proposal.test.ts tests/council-view.test.ts
git commit -m "feat(p8): attach demote-only calibratedConfidence to council proposal + surface it in the view"
```

---

### Task 6: The host pass — `run-p8-calibrate-pass.ts`

**Files:**
- Create: `scripts/run-p8-calibrate-pass.ts`
- Test: `tests/p8-calibrate-pass.test.ts`
- Depends on: Tasks 1, 2, 3, 4

- [ ] **Step 1: Write the failing test**

```ts
// tests/p8-calibrate-pass.test.ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  mapRowsToRecords,
  runP8CalibrateCore,
  type P8PassDeps,
} from "../scripts/run-p8-calibrate-pass.js";
import type { Confidence } from "../src/council/council-types.js";
import type { SelfModTask } from "../src/execution/self-mod-pass.js";

const NEUTRAL: Record<Confidence, number> = { low: 0.5, medium: 0.5, high: 0.5 };

// Build a persisted-row shape: the payload column is the WHOLE ProposalQueueItem.
const row = (status: string, confidence: string) => ({
  status,
  payload: { proposedPayload: { confidence, rootGoal: "g", recommendation: "r", tree: {}, llmCallsUsed: 0 } },
});

describe("mapRowsToRecords", () => {
  it("derives (raw confidence, decision) from the status column + proposedPayload", () => {
    const recs = mapRowsToRecords([
      row("simulated_approved", "high"),
      row("rejected", "high"),
      row("pending_approval", "medium"),
    ]);
    assert.deepEqual(recs[0], { confidence: "high", decision: "approved" });
    assert.deepEqual(recs[1], { confidence: "high", decision: "rejected" });
    assert.deepEqual(recs[2], { confidence: "medium", decision: "pending" });
  });

  it("tolerates a string-encoded payload + missing/invalid fields", () => {
    const recs = mapRowsToRecords([
      { status: "simulated_approved", payload: JSON.stringify({ proposedPayload: { confidence: "low" } }) },
      { status: "rejected", payload: null },
      { status: 42 as any, payload: {} },
    ]);
    assert.deepEqual(recs[0], { confidence: "low", decision: "approved" });
    assert.equal(recs[1].decision, "rejected");
    assert.equal(recs[1].confidence, "low"); // invalid → low
    assert.equal(recs.length, 3);
  });
});

describe("runP8CalibrateCore", () => {
  const baseDeps = (over: Partial<P8PassDeps>): P8PassDeps => ({
    queryCouncilRows: async () => [],
    enqueue: () => {},
    currentPriors: NEUTRAL,
    ...over,
  });

  it("insufficient sample → no enqueue, honest log line", async () => {
    const enq: SelfModTask[] = [];
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => [row("simulated_approved", "high"), row("rejected", "high")], // 2 decided < minSample 4
      enqueue: (t) => enq.push(t),
    }));
    assert.equal(enq.length, 0);
    assert.ok(lines[0].includes("insufficient sample"));
  });

  it("within deadband → no enqueue, no-op log line", async () => {
    const enq: SelfModTask[] = [];
    // 5 high runs, 3 approved → 0.6 vs 0.5 = gap 0.1 ... actually clears deadband; use 0.5 exactly:
    const rows = [
      row("simulated_approved", "high"), row("simulated_approved", "high"),
      row("rejected", "high"), row("rejected", "high"),
    ]; // 2/4 = 0.5 == current → gap 0
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => rows,
      enqueue: (t) => enq.push(t),
    }));
    assert.equal(enq.length, 0);
    assert.ok(lines[0].includes("deadband") || lines[0].includes("no-op"));
  });

  it("well-evidenced delta → enqueues exactly one recalibrate task", async () => {
    const enq: SelfModTask[] = [];
    const rows = [
      row("rejected", "high"), row("rejected", "high"), row("rejected", "high"),
      row("rejected", "high"), row("simulated_approved", "high"),
    ]; // 1/5 = 0.2 vs 0.5 → gap 0.3 > deadband, sample 5 ≥ 4
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => rows,
      enqueue: (t) => enq.push(t),
    }));
    assert.equal(enq.length, 1);
    assert.equal(enq[0].selfModClass, "recalibrate");
    assert.ok(enq[0].description.includes("council-calibration.ts"));
    assert.ok(lines[0].includes("enqueued"));
  });

  it("never throws — a throwing query yields a redacted error line", async () => {
    const lines = await runP8CalibrateCore(baseDeps({
      queryCouncilRows: async () => { throw new Error("boom"); },
    }));
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes("error"));
  });
});
```

- [ ] **Step 2: Run build to verify RED**

Run: `npm run build`
Expected: tsc error — missing module `../scripts/run-p8-calibrate-pass.js`.

- [ ] **Step 3: Implement**

```ts
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
```

- [ ] **Step 4: Run build + test to verify GREEN**

Run: `npm run build` then `node --test dist/tests/p8-calibrate-pass.test.js`
Expected: PASS (all cases). If `tests/` is excluded from the main tsconfig build, confirm the test file compiles the same way existing `tests/*.test.ts` do (it does — they import from both `../src/...js` and `../scripts/...js`; verify a sibling test already imports a script, e.g. `tests/council-host-glue.test.ts` imports `../scripts/run-council-pass.js`).

- [ ] **Step 5: Commit**

```bash
git add scripts/run-p8-calibrate-pass.ts tests/p8-calibrate-pass.test.ts
git commit -m "feat(p8): council-calibration learning pass — aggregate -> decide -> enqueue recalibrate (gated, never throws)"
```

---

### Task 7: Wire the pass into the live-runner

**Files:**
- Modify: `scripts/run-live-runner.ts`

- [ ] **Step 1: Add the import**

Near the other pass imports at the top of `scripts/run-live-runner.ts`, add:

```ts
import { runP8CalibrateOnce } from "./run-p8-calibrate-pass.js";
```

- [ ] **Step 2: Add the cadence constant**

Next to the other `*_EVERY` constants (e.g. `SELF_MOD_EVERY`, `COUNCIL_EVERY`), add:

```ts
const P8_EVERY = 720; // ~1h at the 5s base poll — slow; learning is not time-critical.
```

- [ ] **Step 3: Add the guarded pass block**

Inside the main cycle loop, alongside the other `if (cycle % *_EVERY === 0)` blocks, add (mirror the council block exactly):

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

> `now` and `redact` are already in scope in the loop (used by the existing blocks). If the existing blocks use a differently-named clock variable, match it.

- [ ] **Step 4: Verify build + full suite green**

Run: `npm run build` then `node --test "dist/tests/**/*.test.js"`
Expected: build clean; full suite PASS (previous total + the P8 additions, 0 fail).

- [ ] **Step 5: Confirm the wiring is present**

Run: `git grep -n "P8_EVERY\|runP8CalibrateOnce" scripts/run-live-runner.ts`
Expected: the import, the const, and the guarded block all show.

- [ ] **Step 6: Commit**

```bash
git add scripts/run-live-runner.ts
git commit -m "feat(p8): wire the council-calibration pass into the live-runner (~1h cadence, disarmed)"
```

---

### Task 8: Record the series — build history + memory + final review

**Files:**
- Modify: `docs/BUILD_HISTORY.md`
- (memory files via the Write tool, outside the repo)

- [ ] **Step 1: Add the Era 7 row to `docs/BUILD_HISTORY.md`**

Under the build log, add a new era section after Era 6:

```markdown
### Era 7 — Reflexive learning (Jun 14 →) · it tunes itself from its own track record

| # | Series | What it does | When |
|---|--------|--------------|------|
| 22 | P8 — Reflexive Learning Loop · council-calibration · *code-complete, disarmed* | Aggregates Hart's approve/reject on council proposals into a per-band approval rate, then recalibrates one council constant (`COUNCIL_BAND_APPROVAL`) via the §6 self-mod gauntlet — demote-only, so it can only ever make the council more conservative (§19 intact). Adds zero execution surface; gated behind `HARTOS_ALLOW_LEARNING` (separate from the self-mod triple) | Jun 14 |
```

- [ ] **Step 2: Update "Current state" + "Roadmap ahead"**

In `docs/BUILD_HISTORY.md`, add a P8 bullet to **Current state** (code-complete + disarmed) and prune the P8 line from **Roadmap ahead** (leaving a forward note — e.g. slice 2: action-efficacy → proposer thresholds). Update the **Test suite** count to the new total.

- [ ] **Step 3: Run the full suite once more + commit docs**

Run: `npm run build` then `node --test "dist/tests/**/*.test.js"`
Expected: full suite PASS, 0 fail.

```bash
git add docs/BUILD_HISTORY.md
git commit -m "docs(p8): record the reflexive-learning council-calibration series in the build history"
```

- [ ] **Step 4: Update memory (Write tool, outside the repo)**

Update `hartos-p7-council-status.md` (or add a new `hartos-p8-learning-status.md`) noting P8 slice 1 is code-complete + disarmed: the demote-only calibration knob, the two pure modules, the gated pass, the two independent locks (`HARTOS_ALLOW_LEARNING` + self-mod triple), responsive tuning, and that slice 2 (action-efficacy) is the next cut. Add the index line to `MEMORY.md`. Update `hartos-build-history-log.md` if the era count changed.

---

## Self-Review

**1. Spec coverage:**
- Unit 0 (knob, demote-only) → Task 1. ✔
- Unit 1 (aggregator) → Task 2. ✔
- Unit 2 (decision, surgical description, MIN_SAMPLE/DEADBAND/STEP responsive) → Task 3. ✔
- Unit 3 (pass, gated, never-throws, enqueue) → Task 6; live-runner wiring → Task 7. ✔
- Unit 4 (calibratedConfidence on payload + cockpit note) → Task 5. ✔
- Separate `HARTOS_ALLOW_LEARNING` gate → Task 4 + used in Task 6. ✔
- §19 demote-only, §6 reuse, fail-closed no-op, zero new execution surface → enforced in Tasks 1/6, asserted in tests. ✔
- Integration contracts (whole-item payload → `proposedPayload.confidence`; decision from `status` column) → Task 6 `mapRowsToRecords` + its tests. ✔

**2. Placeholder scan:** No TBD/TODO/"handle edge cases"; every code step shows complete code; every test shows real assertions. ✔

**3. Type consistency:** `Confidence` (`low|medium|high`) and `CouncilDecision` (`approved|rejected|pending`) used identically across Tasks 1–6. `CalibrationAggregate`/`BandStat`/`CouncilRunRecord` defined in Task 2 and imported unchanged in Tasks 3 + 6. `CalibrationTuning`/`DEFAULT_TUNING`/`BandDelta`/`CalibrationDecision` defined in Task 3 and consumed in Task 6. `calibrateConfidence` signature identical in Tasks 1 + 5. `SelfModTask = {selfModClass, description}` matches the existing `src/execution/self-mod-pass.js` export used in Task 6. `QueueFs`/`selfModQueuePath` imported from `./run-self-mod-pass.js` (confirmed exported). ✔

**One watch-item for the implementer:** the deadband test in Task 6 (`within deadband → no-op`) uses 4 high runs at exactly 2 approved (0.5) → gap 0 → no-op; if you change those rows, recompute the rate so it stays inside DEADBAND 0.05. The decide tests in Task 3 are the authoritative arithmetic.

🤖 Planned with [Claude Code](https://claude.com/claude-code)
