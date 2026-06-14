# P7 Council — Plan 1: Single-Level Propose-Only Council (Implementation Plan)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working, testable, **disarmed**, single-level Council: given a goal it selects a panel, fans out to specialists, synthesizes their findings (with dissent surfaced), and emits a `CouncilProposal` — all over injectable ports, propose-only, no live LLM/daemon required for tests.

**Architecture:** Pure orchestration core (`runCouncil`) over injectable ports (mirrors P6's `executeSelfMod`). Specialists behind one `Specialist` interface (LLM-reasoning via an injected infer fn, or a reused-brain adapter). Selection = deterministic registry shortlist + optional LLM refine. Synthesis = fuse findings + consensus/dissent + no-laundering confidence clamp. Output = a `council`/`council_plan` proposal payload. Recursion, the `council.orchestrate` job, and the cockpit panel are later plans; this slice is single-level and has NO live wiring.

**Tech Stack:** TypeScript (NodeNext ESM, `.js` import specifiers), `node:test` + `node:assert/strict`. Build `npm run build` (tsc). Run `node --test "dist/tests/*.test.js"`. Source under `src/council/`, tests under `tests/`.

**Reference (read before starting):** `docs/superpowers/specs/2026-06-14-p7-council-design.md` (the contract); `src/llm/ask-llm.ts` (the injected-infer seam + honest fallback pattern); `src/llm/redaction.ts` (`redact`/`containsSecret`); `src/agents/meta-agent-registry.ts` (`resolveMetaAgentRegistry`); `src/cockpit/proposals/proposal-types.ts` (how P6 added `self-mod`/`self_mod_plan`); `src/doctrine/amendment-gate.ts` (the fail-closed AND-of-flags pattern).

**Safety invariant for this slice:** the Council is DISARMED by default (`councilArmedFromEnv` false unless `HARTOS_ALLOW_COUNCIL=true` AND kill-switch off) and PROPOSE-ONLY — no code path here executes anything or reaches a mutation adapter. It only builds a proposal payload.

---

## File Structure

- Create `src/council/council-types.ts` — all Council types (recursion-ready).
- Create `src/council/council-arming.ts` — `councilArmedFromEnv` + caps constants.
- Create `src/council/specialist.ts` — `Specialist` interface + LLM-specialist runner + brain-adapter.
- Create `src/council/specialist-prompts.ts` — per-specialist system/user prompt builders + output parse/validate (redacted).
- Create `src/council/panel-selection.ts` — deterministic shortlist + optional LLM refine.
- Create `src/council/council-synthesis.ts` — fuse findings + consensus/dissent + confidence clamp.
- Create `src/council/council-coordinator.ts` — `runCouncil` kernel over injectable ports.
- Modify `src/cockpit/proposals/proposal-types.ts` — add `council` domain + `council_plan` actionType.
- Tests: one `tests/council-*.test.ts` per module.

---

## Task 1: Council types + proposal contract

**Files:**
- Create: `src/council/council-types.ts`
- Modify: `src/cockpit/proposals/proposal-types.ts` (add `"council"` to the domain union, `"council_plan"` to the actionType union — find the unions exactly as P6 added `self-mod`/`self_mod_plan`)
- Test: `tests/council-types.test.ts`

- [ ] **Step 1: Write the failing test** (`tests/council-types.test.ts`)

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONFIDENCE_BANDS, isConfidence, type SpecialistFinding } from "../src/council/council-types.js";

describe("council-types", () => {
  it("confidence bands are ordered low<medium<high", () => {
    assert.deepEqual(CONFIDENCE_BANDS, ["low", "medium", "high"]);
  });
  it("isConfidence guards the band union", () => {
    assert.equal(isConfidence("high"), true);
    assert.equal(isConfidence("certain"), false);
  });
  it("a SpecialistFinding carries lens, summary, confidence, risks", () => {
    const f: SpecialistFinding = { specialistId: "cto", lens: "feasibility", summary: "buildable in ~6w", confidence: "medium", risks: ["auth scope"], degraded: false };
    assert.equal(f.confidence, "medium");
  });
});
```

- [ ] **Step 2: Run it, verify it fails** — Run: `npm run build` (expect: cannot find module `council-types`).

- [ ] **Step 3: Implement `src/council/council-types.ts`**

```ts
/** P7 Council — shared types (recursion-ready: a CouncilNode may nest sub-councils). PURE. */

export const CONFIDENCE_BANDS = ["low", "medium", "high"] as const;
export type Confidence = (typeof CONFIDENCE_BANDS)[number];
export function isConfidence(v: unknown): v is Confidence {
  return typeof v === "string" && (CONFIDENCE_BANDS as readonly string[]).includes(v);
}

/** A goal handed to the council (or a scoped sub-goal). */
export interface CouncilGoal { goal: string; context?: string; }

/** One specialist's contribution. `degraded` = the specialist failed/timed-out or ran LLM-off. */
export interface SpecialistFinding {
  specialistId: string;
  lens: string;
  summary: string;
  confidence: Confidence;
  risks: string[];
  degraded: boolean;
}

/** The fused verdict for one council node. */
export interface Synthesis {
  recommendation: string;
  confidence: Confidence;       // no-laundering: never above the weakest corroborating finding
  consensus: string[];          // points the panel agreed on
  dissent: string[];            // disagreements / open splits, surfaced not averaged
  truncated: boolean;           // a cap was hit → synthesized from partial input
  notes: string[];              // honest gaps (absent specialists, degraded findings)
}

/** A node in the council tree (root or recursive sub-coordinator). Slice 1 emits depth-1 trees. */
export interface CouncilNode {
  goal: CouncilGoal;
  panel: string[];              // specialist ids convened here
  findings: SpecialistFinding[];
  synthesis: Synthesis;
  children: CouncilNode[];      // sub-coordinator nodes (empty in slice 1)
  depth: number;
}

/** The proposal payload the coordinator emits (the whole tree + the top recommendation). */
export interface CouncilProposalPayload {
  rootGoal: string;
  recommendation: string;
  confidence: Confidence;
  tree: CouncilNode;
  llmCallsUsed: number;
}
```

- [ ] **Step 4: Add the proposal-types entries** — in `src/cockpit/proposals/proposal-types.ts` add `"council"` to the `ProposalDomain` union and `"council_plan"` to the `ProposalActionType` union (match the file's existing style; do not change anything else).

- [ ] **Step 5: Build + test** — Run: `npm run build && node --test "dist/tests/council-types.test.js"` (expect PASS). Also run the existing `tests/*proposal*` and `tests/*doctrine-conformance*` to confirm the union additions broke nothing.

- [ ] **Step 6: Commit** — `git add src/council/council-types.ts src/cockpit/proposals/proposal-types.ts tests/council-types.test.ts && git commit -m "feat(council): P7 — council types + council/council_plan proposal contract"`

---

## Task 2: Council arming gate + caps (fail-closed, disarmed)

**Files:** Create `src/council/council-arming.ts`; Test `tests/council-arming.test.ts`

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { councilArmedFromEnv, COUNCIL_CAPS } from "../src/council/council-arming.js";

describe("councilArmedFromEnv", () => {
  it("disarmed by default", () => assert.equal(councilArmedFromEnv({}), false));
  it("armed only with HARTOS_ALLOW_COUNCIL=true and kill-switch off", () => {
    assert.equal(councilArmedFromEnv({ HARTOS_ALLOW_COUNCIL: "true" }), true);
  });
  it("kill-switch ON disarms even when allowed", () => {
    assert.equal(councilArmedFromEnv({ HARTOS_ALLOW_COUNCIL: "true", HARTOS_EXECUTION_KILL_SWITCH: "on" }), false);
  });
  it("non-'true' values do not arm (fail-closed)", () => {
    assert.equal(councilArmedFromEnv({ HARTOS_ALLOW_COUNCIL: "1" }), false);
  });
  it("caps have sane defaults", () => {
    assert.ok(COUNCIL_CAPS.maxDepth >= 1 && COUNCIL_CAPS.maxPanel >= 1 && COUNCIL_CAPS.maxLlmCalls >= 1);
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `src/council/council-arming.ts`**

```ts
/** P7 Council arming + caps. Fail-closed: armed only by HARTOS_ALLOW_COUNCIL=true AND kill-switch off. */
type Env = Record<string, string | undefined>;

export const COUNCIL_ALLOW_ENV = "HARTOS_ALLOW_COUNCIL";
export const KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";

export const COUNCIL_CAPS = { maxDepth: 3, maxPanel: 5, maxLlmCalls: 30, specialistTimeoutMs: 60_000 } as const;

export function councilArmedFromEnv(env: Env): boolean {
  if ((env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on") return false;
  return (env[COUNCIL_ALLOW_ENV] ?? "").trim() === "true";
}
```

- [ ] **Step 4: Build + test** — `npm run build && node --test "dist/tests/council-arming.test.js"` (PASS).
- [ ] **Step 5: Commit** — `git commit -m "feat(council): P7 — arming gate (HARTOS_ALLOW_COUNCIL, fail-closed) + caps"`

---

## Task 3: Specialist prompts (redacted build + output parse)

**Files:** Create `src/council/specialist-prompts.ts`; Test `tests/council-specialist-prompts.test.ts`

Defines the 5 lenses and builds a redacted prompt + parses a finding from raw model text. No network here.

- [ ] **Step 1: Failing test**

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { SPECIALIST_LENSES, buildSpecialistPrompt, parseFinding } from "../src/council/specialist-prompts.js";

describe("specialist-prompts", () => {
  it("ships the 5 lenses", () => {
    assert.deepEqual(Object.keys(SPECIALIST_LENSES).sort(), ["cto", "financial", "legal", "ma", "research"]);
  });
  it("prompt embeds the lens + goal and is redacted", () => {
    const p = buildSpecialistPrompt("cto", { goal: "build a CRM", context: "key=sk-ABCDEF1234567890ABCDEF" });
    assert.match(p.system, /feasibility|architecture/i);
    assert.ok(!/sk-ABCDEF1234567890ABCDEF/.test(p.user), "secret must be redacted from the prompt");
  });
  it("parseFinding tolerates malformed model output → degraded finding", () => {
    const f = parseFinding("cto", "not json at all");
    assert.equal(f.degraded, true);
    assert.equal(f.specialistId, "cto");
  });
  it("parseFinding reads a well-formed JSON finding", () => {
    const raw = JSON.stringify({ summary: "ok", confidence: "high", risks: ["scope"] });
    const f = parseFinding("financial", raw);
    assert.equal(f.confidence, "high");
    assert.equal(f.degraded, false);
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `src/council/specialist-prompts.ts`** — define `SPECIALIST_LENSES` (research/cto/financial/ma/legal → a one-line lens description + the JSON output contract), `buildSpecialistPrompt(id, goal)` (system = role+lens+"return ONLY JSON {summary,confidence,risks[]}"; user = redacted goal+context via `redact` from `../llm/redaction.js`), and `parseFinding(id, rawText)` (JSON.parse + shape/confidence validation via `isConfidence`; any failure → `{degraded:true, confidence:"low", summary: redacted snippet, risks:[]}`). Never throws.

- [ ] **Step 4: Build + test** (PASS). - [ ] **Step 5: Commit** — `git commit -m "feat(council): P7 — specialist prompts (5 lenses, redacted, fail-closed parse)"`

---

## Task 4: Specialist interface + runners (LLM + brain adapter)

**Files:** Create `src/council/specialist.ts`; Test `tests/council-specialist.test.ts`

- [ ] **Step 1: Failing test** — assert: (a) an LLM specialist with an injected infer fn returns a parsed finding; (b) infer throwing → `degraded:true` finding (never throws); (c) a timeout → degraded finding; (d) a brain-adapter wraps an injected brain call into a `SpecialistFinding`.

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { makeLlmSpecialist, makeBrainSpecialist } from "../src/council/specialist.js";

describe("specialist runners", () => {
  it("LLM specialist returns a parsed finding", async () => {
    const infer = async () => JSON.stringify({ summary: "feasible", confidence: "medium", risks: [] });
    const s = makeLlmSpecialist("cto", infer);
    const f = await s.run({ goal: "build CRM" });
    assert.equal(f.specialistId, "cto");
    assert.equal(f.degraded, false);
  });
  it("infer throws → degraded finding, never throws", async () => {
    const s = makeLlmSpecialist("cto", async () => { throw new Error("boom"); });
    const f = await s.run({ goal: "x" });
    assert.equal(f.degraded, true);
  });
  it("brain specialist adapts an injected brain result", async () => {
    const s = makeBrainSpecialist("research", "prior-art", async () => ({ summary: "found 3 refs", confidence: "high", risks: [] }));
    const f = await s.run({ goal: "x" });
    assert.equal(f.summary, "found 3 refs");
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `src/council/specialist.ts`**

```ts
import type { CouncilGoal, SpecialistFinding } from "./council-types.js";
import { buildSpecialistPrompt, parseFinding } from "./specialist-prompts.js";

/** A specialist convened by a council node. run() never throws — failure ⇒ a degraded finding. */
export interface Specialist {
  id: string;
  run(goal: CouncilGoal): Promise<SpecialistFinding>;
}

/** The injected model call (mirrors ask-llm's AskInfer seam). Returns raw model text. */
export type Infer = (prompt: { system: string; user: string }) => Promise<string>;

const TIMEOUT_MS = 60_000;
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(onTimeout()); });
  });
}

export function makeLlmSpecialist(id: string, infer: Infer, timeoutMs = TIMEOUT_MS): Specialist {
  return {
    id,
    run: (goal) => {
      const degraded = (): SpecialistFinding => ({ specialistId: id, lens: id, summary: "(no finding — degraded)", confidence: "low", risks: [], degraded: true });
      const work = (async () => {
        try { return parseFinding(id, await infer(buildSpecialistPrompt(id, goal))); }
        catch { return degraded(); }
      })();
      return withTimeout(work, timeoutMs, degraded);
    },
  };
}

/** Wrap a deterministic brain (injected) as a specialist. */
export function makeBrainSpecialist(
  id: string, lens: string,
  brain: (goal: CouncilGoal) => Promise<{ summary: string; confidence: SpecialistFinding["confidence"]; risks: string[] }>,
): Specialist {
  return {
    id,
    run: async (goal) => {
      try { const r = await brain(goal); return { specialistId: id, lens, summary: r.summary, confidence: r.confidence, risks: r.risks, degraded: false }; }
      catch { return { specialistId: id, lens, summary: "(brain failed)", confidence: "low", risks: [], degraded: true }; }
    },
  };
}
```

- [ ] **Step 4: Build + test** (PASS). - [ ] **Step 5: Commit** — `git commit -m "feat(council): P7 — Specialist interface + LLM/brain runners (never-throw, timeout→degraded)"`

---

## Task 5: Panel selection (deterministic shortlist + optional LLM refine)

**Files:** Create `src/council/panel-selection.ts`; Test `tests/council-panel-selection.test.ts`

- [ ] **Step 1: Failing test** — assert: (a) with no refiner, returns the deterministic default roster (research, cto, financial, ma, legal), capped at `maxPanel`; (b) an injected refiner can trim/reorder but cannot introduce an unknown specialist (filtered); (c) refiner throwing → falls back to the deterministic shortlist.

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `src/council/panel-selection.ts`** — `DEFAULT_ROSTER = ["research","cto","financial","ma","legal"]`. `selectPanel(goal, opts?)`: start from `DEFAULT_ROSTER` (a later plan swaps this for a registry capability-match); if `opts.refine` provided, call it, intersect its result with the known roster (drop unknowns), keep order; on throw → deterministic shortlist; finally `.slice(0, opts?.maxPanel ?? COUNCIL_CAPS.maxPanel)`. Pure aside from the injected refiner. Never throws.

- [ ] **Step 4: Build + test** (PASS). - [ ] **Step 5: Commit** — `git commit -m "feat(council): P7 — panel selection (deterministic roster + guarded LLM refine)"`

---

## Task 6: Synthesis (consensus/dissent + no-laundering confidence)

**Files:** Create `src/council/council-synthesis.ts`; Test `tests/council-synthesis.test.ts`

- [ ] **Step 1: Failing test** — assert: (a) synthesized confidence never exceeds the weakest NON-degraded finding (no laundering); (b) all-degraded/empty → low confidence + a note; (c) dissent captures conflicting risk signals; (d) `truncated` flag passes through.

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { synthesize } from "../src/council/council-synthesis.js";

describe("synthesize", () => {
  it("confidence never exceeds the weakest non-degraded finding", () => {
    const s = synthesize([
      { specialistId: "cto", lens: "x", summary: "yes", confidence: "high", risks: [], degraded: false },
      { specialistId: "legal", lens: "y", summary: "risky", confidence: "low", risks: ["GDPR"], degraded: false },
    ], { truncated: false });
    assert.equal(s.confidence, "low");
    assert.ok(s.dissent.length > 0 || s.notes.length >= 0);
  });
  it("all degraded → low + honest note", () => {
    const s = synthesize([{ specialistId: "cto", lens: "x", summary: "", confidence: "low", risks: [], degraded: true }], { truncated: false });
    assert.equal(s.confidence, "low");
    assert.ok(s.notes.some((n) => /degraded|no finding/i.test(n)));
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `src/council/council-synthesis.ts`** — `synthesize(findings, { truncated })`: non-degraded = findings where `!degraded`; `confidence` = the MIN band across non-degraded (low<medium<high), or `"low"` if none; `consensus` = summaries shared/agreed (slice 1: list each non-degraded specialist's one-line summary); `dissent` = specialists whose `confidence==="low"` or whose risks conflict, surfaced; `notes` = degraded/absent specialists + (if truncated) the cap note; `recommendation` = a deterministic roll-up string of the panel's summaries (LLM-authored recommendation is a later plan; here keep it deterministic + honest). PURE, never throws.

- [ ] **Step 4: Build + test** (PASS). - [ ] **Step 5: Commit** — `git commit -m "feat(council): P7 — synthesis (consensus/dissent + no-laundering confidence)"`

---

## Task 7: Single-level Council Coordinator (the kernel, disarmed)

**Files:** Create `src/council/council-coordinator.ts`; Test `tests/council-coordinator.test.ts`

- [ ] **Step 1: Failing test** — assert over injectable ports: (a) disarmed → returns `{skipped:true}`, runs no specialist; (b) armed → selects panel, runs each specialist concurrently, synthesizes, returns a `CouncilProposalPayload` with a depth-1 tree; (c) respects `maxPanel`; (d) counts llm calls and stops selecting once `maxLlmCalls` would be exceeded, setting `truncated`; (e) a specialist that throws is already degraded (never breaks the run).

```ts
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCouncil, type CouncilPorts } from "../src/council/council-coordinator.js";

function ports(over: Partial<CouncilPorts> = {}): CouncilPorts {
  return {
    isArmed: () => true,
    selectPanel: () => ["cto", "financial"],
    runSpecialist: async (id) => ({ specialistId: id, lens: id, summary: id + " ok", confidence: "medium", risks: [], degraded: false }),
    caps: { maxPanel: 5, maxLlmCalls: 30 },
    ...over,
  };
}

describe("runCouncil", () => {
  it("disarmed → skip, no specialist run", async () => {
    let ran = 0;
    const r = await runCouncil({ goal: "x" }, ports({ isArmed: () => false, runSpecialist: async (id) => { ran++; return { specialistId: id, lens: id, summary: "", confidence: "low", risks: [], degraded: true }; } }));
    assert.equal(r.skipped, true);
    assert.equal(ran, 0);
  });
  it("armed → builds a depth-1 CouncilProposalPayload", async () => {
    const r = await runCouncil({ goal: "build CRM" }, ports());
    assert.equal(r.skipped, false);
    assert.equal(r.payload?.tree.depth, 1);
    assert.equal(r.payload?.tree.findings.length, 2);
  });
});
```

- [ ] **Step 2: Run, verify it fails.**

- [ ] **Step 3: Implement `src/council/council-coordinator.ts`**

```ts
import type { CouncilGoal, CouncilNode, CouncilProposalPayload, SpecialistFinding } from "./council-types.js";
import { synthesize } from "./council-synthesis.js";

export interface CouncilPorts {
  isArmed(): boolean;
  selectPanel(goal: CouncilGoal): string[];
  runSpecialist(id: string, goal: CouncilGoal): Promise<SpecialistFinding>;
  caps: { maxPanel: number; maxLlmCalls: number };
}

export interface CouncilRunResult {
  skipped: boolean;
  reason: string;
  payload?: CouncilProposalPayload;
}

/** Single-level council: select → fan out (bounded, concurrent) → synthesize → payload. Disarmed ⇒ skip.
 *  Propose-only: returns a payload; NEVER executes. A specialist never throws (it self-degrades). */
export async function runCouncil(goal: CouncilGoal, ports: CouncilPorts): Promise<CouncilRunResult> {
  if (!ports.isArmed()) return { skipped: true, reason: "council disarmed (HARTOS_ALLOW_COUNCIL / kill-switch)" };

  const panel = ports.selectPanel(goal).slice(0, ports.caps.maxPanel);
  const allowed = Math.min(panel.length, ports.caps.maxLlmCalls);
  const convened = panel.slice(0, allowed);
  const truncated = convened.length < panel.length;

  const findings = await Promise.all(convened.map((id) => ports.runSpecialist(id, goal)));
  const synthesis = synthesize(findings, { truncated });

  const tree: CouncilNode = { goal, panel: convened, findings, synthesis, children: [], depth: 1 };
  const payload: CouncilProposalPayload = {
    rootGoal: goal.goal,
    recommendation: synthesis.recommendation,
    confidence: synthesis.confidence,
    tree,
    llmCallsUsed: convened.length,
  };
  return { skipped: false, reason: "council synthesized", payload };
}
```

- [ ] **Step 4: Build + run the FULL suite** — `npm run build && node --test "dist/tests/*.test.js"` (expect 0 failures; confirms the proposal-types union additions + all new modules integrate).
- [ ] **Step 5: Commit** — `git commit -m "feat(council): P7 — single-level coordinator kernel (runCouncil over ports, disarmed, propose-only)"`

---

## Definition of done (this slice)

A disarmed, propose-only, single-level Council that — given a goal and real-or-injected ports — selects the 5-specialist panel, fans out concurrently, self-degrades on any specialist failure/timeout, synthesizes with consensus/dissent and no-laundering confidence, and emits a `CouncilProposalPayload`. Full suite green. No live LLM/daemon/cockpit wiring yet (Plans 2–3). Nothing is armed; nothing executes.

## Self-review (done while writing)

- **Spec coverage:** §3 cycle steps 2–5 (convene/fan-out/gather/synthesize) + §6 caps + §7 payload + §4.1 roster are all implemented; steps 1 (Factory spec) + 6 (bubble-up/recursion) and the job/cockpit wiring are explicitly deferred to Plans 2–3.
- **Placeholders:** none — every task has real code or a precise behavioral contract + tests.
- **Type consistency:** `SpecialistFinding`/`Confidence`/`Synthesis`/`CouncilNode`/`CouncilProposalPayload` are used identically across tasks; `Infer` mirrors the ask-llm seam; `councilArmedFromEnv` mirrors `isSelfModArmed`.
