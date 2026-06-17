# Wolverine host-offline inference Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop Wolverine from minting "X is down — investigate" synapses when Hart simply powered his computer off; replace the spam with one calm, auto-expiring "host was offline" notice, while still firing for genuine single-agent failures.

**Architecture:** Sentinel already computes liveness from evidence age. We add a pure, deterministic gate: tag each heartbeat as **host-bound** (a local artifact/file that dies when the PC is off) or **cloud** (always-on). If the *freshest* host-bound evidence is itself stale, the whole host was off → flag those silences `offlineExpected` and emit one calm note instead of N investigations. If even one host-bound agent is fresh, the host was on, so any other host-bound silence is treated as organic and fires normally. The in-Worker path has no host-bound evidence, so it can never falsely declare the PC off.

**Tech Stack:** TypeScript (ESM, NodeNext), `node:test` + `node:assert/strict`. Build with `tsc`; tests run from `dist/`.

**Spec:** [docs/superpowers/specs/2026-06-17-wolverine-host-offline-design.md](../specs/2026-06-17-wolverine-host-offline-design.md)

**Conventions for every task:**
- Pure-core modules take no clock — `now` is always injected.
- Run all tests: `npm test` (does `tsc` then runs every `dist/tests/*.test.js`).
- Run one file during dev: `npm run build` then `node --test "dist/tests/<file>.test.js"`.
- New interface fields are **optional** (`?:`) so existing hand-built test fixtures still compile; `assessFleetLiveness` always sets concrete values.
- Every commit message ends with the `Co-Authored-By` trailer shown in the commit steps.

---

## File structure

| File | Responsibility | Change |
| --- | --- | --- |
| `src/sentinel/sentinel-liveness.ts` | Pure liveness core | Add `hostBound`/`offlineExpected`/`HostOfflineNote`/`hostOffline`; the host-offline gate; calm line in `describeFleetLiveness` |
| `src/sentinel/sentinel-host.ts` | Local (Node) evidence gathering | Tag every gathered heartbeat `hostBound: true` |
| `src/sentinel/evidence-model.ts` | Raw-evidence intake (pure) | Carry `hostBound` through `RawEvidence` → `AgentHeartbeat` |
| `src/sentinel/heartbeat-gatherer.ts` | Assemble Worker/cron heartbeats (pure) | Worker self-beat + read-models = NOT host-bound; localRunner carries its own flag |
| `src/wolverine/sentinel-wolverine-bridge.ts` | Verdicts → FixProposals (pure) | Skip `offlineExpected` per-agent cards; emit one calm ack card from `fleet.hostOffline` |
| `src/wolverine/detectors/agent-liveness.ts` | Verdicts → audit findings (pure) | Skip `offlineExpected` verdicts |
| `src/sentinel/sentinel-heartbeat.ts` | Cron alert policy (pure) | `heartbeatShouldAlert` ignores `offlineExpected`; log line carries the host-offline summary |
| `tests/sentinel-liveness.test.ts` | Core tests | + host-offline gate cases |
| `tests/sentinel-evidence-model.test.ts` | Evidence intake tests | NEW (small) — `hostBound` carry-through |
| `tests/sentinel-host.test.ts` | Host gatherer test | NEW (small) — every beat host-bound |
| `tests/sentinel-wolverine-bridge.test.ts` | Bridge tests | + ack-card + offlineExpected-skip cases |
| `tests/wolverine-agent-liveness.test.ts` | Detector tests | + offlineExpected-skip case |
| `tests/sentinel-heartbeat.test.ts` | Alert-policy tests | + offlineExpected cases |

---

## Task 1: Host-offline gate in the pure core

**Files:**
- Modify: `src/sentinel/sentinel-liveness.ts`
- Test: `tests/sentinel-liveness.test.ts`

- [ ] **Step 1: Write the failing tests**

Append these cases inside the existing `describe("assessFleetLiveness", ...)` block in `tests/sentinel-liveness.test.ts` (the `REG`, `NOW`, `hoursAgo` helpers already exist at the top of the file):

```ts
  it("host-offline: all host-bound evidence stale ⇒ those silences flagged offlineExpected + one note", () => {
    const fleet = assessFleetLiveness(
      REG,
      [
        { agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true },
        { agentId: "beezulbub", lastEvidenceAt: hoursAgo(50), evidenceSource: "beezulbub-reports/", hostBound: true },
      ],
      NOW,
    );
    const research = fleet.verdicts.find((v) => v.agentId === "research")!;
    const beezulbub = fleet.verdicts.find((v) => v.agentId === "beezulbub")!;
    assert.equal(research.offlineExpected, true);
    assert.equal(beezulbub.offlineExpected, true);
    assert.ok(fleet.hostOffline, "hostOffline note populated");
    assert.equal(fleet.hostOffline!.since, hoursAgo(40)); // freshest host-bound evidence
    assert.ok(fleet.hostOffline!.agents.includes("Research Agent"));
    assert.match(fleet.hostOffline!.reason, /offline/i);
  });

  it("host-on: one host-bound agent fresh ⇒ no host-offline gate; a separate stale agent stays organic", () => {
    const fleet = assessFleetLiveness(
      REG,
      [
        { agentId: "research", lastEvidenceAt: hoursAgo(1), evidenceSource: "research-reports/", hostBound: true },
        { agentId: "beezulbub", lastEvidenceAt: hoursAgo(40), evidenceSource: "beezulbub-reports/", hostBound: true },
      ],
      NOW,
    );
    assert.equal(fleet.hostOffline, null);
    const beezulbub = fleet.verdicts.find((v) => v.agentId === "beezulbub")!;
    assert.equal(beezulbub.state, "stale");
    assert.ok(!beezulbub.offlineExpected, "stale-while-host-on is organic, not offlineExpected");
  });

  it("cloud-only heartbeats (no hostBound) never trigger the host-offline gate", () => {
    const fleet = assessFleetLiveness(
      REG,
      [{ agentId: "ops", lastEvidenceAt: hoursAgo(100), evidenceSource: "ops read-model" }],
      NOW,
    );
    assert.equal(fleet.hostOffline, null);
    assert.ok(!fleet.verdicts.find((v) => v.agentId === "ops")!.offlineExpected);
  });

  it("describeFleetLiveness prints a calm host-offline line when the host was off", () => {
    const fleet = assessFleetLiveness(
      REG,
      [{ agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true }],
      NOW,
    );
    assert.match(describeFleetLiveness(fleet), /Host appears OFFLINE/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test "dist/tests/sentinel-liveness.test.js"`
Expected: the 4 new cases FAIL (e.g. `hostOffline` is `undefined`, `offlineExpected` undefined). The pre-existing cases still PASS.

- [ ] **Step 3: Add the new fields to the interfaces**

In `src/sentinel/sentinel-liveness.ts`, add `hostBound` to `AgentHeartbeat` (after `upstreamStale`):

```ts
  upstreamStale?: boolean;
  /**
   * The evidence came from a HOST-BOUND source (a local artifact/file that goes dark the moment
   * Hart's machine is off), as opposed to an always-on cloud source (the answering Worker, a
   * Supabase read-model). Set by the edge that read it. Absent ⇒ treated as cloud (false).
   */
  hostBound?: boolean;
```

Add `hostBound` + `offlineExpected` to `LivenessVerdict` (after `catalogStatus`):

```ts
  catalogStatus: MetaAgent["status"];
  /** Carried from the heartbeat: was this agent's evidence host-bound? (default false) */
  hostBound?: boolean;
  /**
   * The host-offline gate concluded the whole machine was simply off, so this agent's silence is
   * EXPECTED, not organic. Downstream (Wolverine bridge/detector, the alert policy) stay quiet on it.
   */
  offlineExpected?: boolean;
```

Add the `HostOfflineNote` interface immediately above `FleetLiveness`, and a field on `FleetLiveness`:

```ts
/** One calm rollup raised in place of N "down — investigate" findings when the host was simply off. */
export interface HostOfflineNote {
  /** ISO of the freshest host-bound evidence (when the host was last demonstrably on), or null. */
  since: string | null;
  /** Hours since `since` (rounded 0.1h), or null when no host-bound evidence parsed. */
  ageHours: number | null;
  /** Display names of the host-bound agents whose silence is treated as expected. */
  agents: string[];
  reason: string;
}

export interface FleetLiveness {
  generatedAt: string;
  verdicts: LivenessVerdict[];
  counts: { up: number; stale: number; down: number; unknown: number; assessed: number };
  /** GREEN = nothing down/stale; AMBER = something stale/unknown; RED = something down. */
  overall: "GREEN" | "AMBER" | "RED";
  overallReason: string;
  /** Set when the host-offline gate fired; null otherwise. */
  hostOffline?: HostOfflineNote | null;
}
```

- [ ] **Step 4: Carry `hostBound` onto every verdict**

Still in `assessFleetLiveness`, add `hostBound: !!hb?.hostBound,` to **each** of the four returned verdict object literals (the `upstreamStale` branch, the no-hb/null branch, the unparseable branch, and the normal branch). Put it right after the `catalogStatus: agent.status,` line in each. Example for the normal (final) branch:

```ts
    return {
      agentId: agent.id,
      displayName: agent.displayName,
      state,
      lastEvidenceAt: hb.lastEvidenceAt,
      ageHours,
      evidenceSource: hb.evidenceSource,
      reason,
      catalogStatus: agent.status,
      hostBound: !!hb?.hostBound,
    };
```

(Do the same one-line addition in the other three `return { ... }` blocks.)

- [ ] **Step 5: Add the host-offline gate**

In `assessFleetLiveness`, after the `verdicts.sort(...)` line and **before** the `const counts = {...}` block, insert:

```ts
  // ── Host-offline gate ───────────────────────────────────────────────────────
  // If the freshest evidence among HOST-BOUND agents is itself stale (or there is none), the whole
  // machine was simply off — those agents' shared silence is EXPECTED, not organic. Flag them so the
  // Wolverine bridge/detector + alert policy stay quiet and surface ONE calm note instead of N. If
  // even one host-bound agent is fresh, the host was on ⇒ no gate ⇒ other silences stay organic.
  let hostOffline: HostOfflineNote | null = null;
  const hostBoundVerdicts = verdicts.filter((v) => v.hostBound);
  if (hostBoundVerdicts.length > 0) {
    const hostTimes = hostBoundVerdicts
      .map((v) => (v.lastEvidenceAt === null ? NaN : Date.parse(v.lastEvidenceAt)))
      .filter((ms) => Number.isFinite(ms));
    const freshestMs = hostTimes.length > 0 ? Math.max(...hostTimes) : null;
    const hostAgeHours =
      freshestMs !== null && Number.isFinite(nowMs)
        ? Math.round(((nowMs - freshestMs) / 36e5) * 10) / 10
        : null;
    const hostOff = freshestMs === null || hostAgeHours === null || hostAgeHours > staleHours;
    if (hostOff) {
      const quiet = hostBoundVerdicts.filter((v) => v.state === "down" || v.state === "stale");
      for (const v of quiet) v.offlineExpected = true;
      const since = freshestMs === null ? null : new Date(freshestMs).toISOString();
      hostOffline = {
        since,
        ageHours: hostAgeHours,
        agents: quiet.map((v) => v.displayName),
        reason:
          since === null
            ? "No host-bound agent has produced any evidence — the host appears offline; shared silence is expected, not a failure."
            : `Freshest host-bound evidence is ${hostAgeHours}h old (> ${staleHours}h) — the host appears to have been offline since then; shared silence is expected, not a failure.`,
      };
    }
  }
```

Then add `hostOffline` to the returned object (the final `return { generatedAt: now, verdicts, counts, overall, overallReason };`):

```ts
  return { generatedAt: now, verdicts, counts, overall, overallReason, hostOffline };
```

- [ ] **Step 6: Add the calm line to `describeFleetLiveness`**

In `describeFleetLiveness`, after the `up ... stale ... down ... unknown` summary line is pushed and before the per-agent `for` loop, insert:

```ts
  if (fleet.hostOffline) {
    lines.push(
      `  ⚐ Host appears OFFLINE — ${fleet.hostOffline.agents.length} agent(s) quiet (expected, no action): ${fleet.hostOffline.reason}`,
    );
  }
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm run build && node --test "dist/tests/sentinel-liveness.test.js"`
Expected: all cases PASS (new + pre-existing).

- [ ] **Step 8: Commit**

```bash
git add src/sentinel/sentinel-liveness.ts tests/sentinel-liveness.test.ts
git commit -m "feat(sentinel): host-offline gate — expected silence is not organic failure

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Carry `hostBound` through the evidence intake

**Files:**
- Modify: `src/sentinel/evidence-model.ts`
- Test: `tests/sentinel-evidence-model.test.ts` (NEW)

- [ ] **Step 1: Write the failing test**

Create `tests/sentinel-evidence-model.test.ts`:

```ts
/**
 * tests/sentinel-evidence-model.test.ts — raw-evidence intake carries hostBound through honestly.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeEvidence } from "../src/sentinel/evidence-model.js";

const NOW = "2026-06-11T12:00:00.000Z";

describe("normalizeEvidence", () => {
  it("carries hostBound through when set", () => {
    const hb = normalizeEvidence(
      { agentId: "research", observedAt: NOW, evidenceSource: "research-reports/", hostBound: true },
      NOW,
    );
    assert.equal(hb.hostBound, true);
  });

  it("omits hostBound when not set (⇒ cloud by default)", () => {
    const hb = normalizeEvidence({ agentId: "ops", observedAt: NOW, evidenceSource: "ops read-model" }, NOW);
    assert.equal(hb.hostBound, undefined);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test "dist/tests/sentinel-evidence-model.test.js"`
Expected: FAIL (TS error / `hostBound` is `undefined` because `RawEvidence` has no such field and `normalizeEvidence` does not forward it).

- [ ] **Step 3: Add `hostBound` to `RawEvidence` and forward it**

In `src/sentinel/evidence-model.ts`, add to `RawEvidence` (after `upstreamStale`):

```ts
  upstreamStale?: boolean;
  /** The observation came from a host-bound source (dies when Hart's machine is off). */
  hostBound?: boolean;
```

In `normalizeEvidence`, forward it in the returned object (after the `upstreamStale` spread):

```ts
  return {
    agentId: raw.agentId,
    lastEvidenceAt: trustworthy ? raw.observedAt : null,
    evidenceSource: raw.evidenceSource,
    ...(raw.upstreamStale ? { upstreamStale: true } : {}),
    ...(raw.hostBound ? { hostBound: true } : {}),
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test "dist/tests/sentinel-evidence-model.test.js"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/sentinel/evidence-model.ts tests/sentinel-evidence-model.test.ts
git commit -m "feat(sentinel): RawEvidence carries hostBound through normalizeEvidence

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Mark Worker/read-model evidence as cloud; local evidence as host-bound

**Files:**
- Modify: `src/sentinel/heartbeat-gatherer.ts`
- Modify: `src/sentinel/sentinel-host.ts`
- Test: `tests/sentinel-host.test.ts` (NEW), and extend `tests/sentinel-heartbeat.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `tests/sentinel-host.test.ts`:

```ts
/**
 * tests/sentinel-host.test.ts — local heartbeats are all host-bound (they die when the PC is off).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { gatherLocalHeartbeats } from "../src/sentinel/sentinel-host.js";

describe("gatherLocalHeartbeats", () => {
  it("tags every gathered heartbeat host-bound", () => {
    // No env ⇒ no memory-capture beat; the EVIDENCE_DIRS beats are still produced (lastEvidenceAt
    // may be null when the dir is absent), and every one must be host-bound.
    const beats = gatherLocalHeartbeats({});
    assert.ok(beats.length > 0);
    for (const b of beats) {
      assert.equal(b.hostBound, true, `${b.agentId} must be host-bound`);
    }
  });
});
```

Add to `tests/sentinel-heartbeat.test.ts`, inside `describe("heartbeatsFromReadModels", ...)`:

```ts
  it("never marks cloud evidence host-bound (Worker self-beat + read-models)", () => {
    const hb = heartbeatsFromReadModels({ staleSources: ["ops"], enabledSources: ["fitness", "ops"] }, NOW, NOW);
    for (const h of hb) {
      assert.notEqual(h.hostBound, true, `${h.agentId} is cloud, not host-bound`);
    }
  });
```

(Also extend the gatherer test — `tests/sentinel-heartbeat.test.ts` already imports `heartbeatsFromReadModels`.)

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test "dist/tests/sentinel-host.test.js" "dist/tests/sentinel-heartbeat.test.js"`
Expected: the new `sentinel-host` case FAILS (`hostBound` is `undefined`); the new heartbeat case PASSES already (read-models never set hostBound) — that's fine, it is a guard against regression. If the host case is the only failure, proceed.

- [ ] **Step 3: Tag local heartbeats host-bound**

In `src/sentinel/sentinel-host.ts`, in `gatherLocalHeartbeats`, add `hostBound: true` to **both** pushed heartbeat shapes.

The EVIDENCE_DIRS loop push:

```ts
    heartbeats.push({
      agentId,
      lastEvidenceAt: t === null ? null : new Date(t).toISOString(),
      evidenceSource: `${dir}/ newest artifact`,
      hostBound: true,
    });
```

The memory-capture push (present branch):

```ts
      heartbeats.push({
        agentId: "executive-memory",
        lastEvidenceAt: new Date(st.mtimeMs).toISOString(),
        evidenceSource: "memory-capture file",
        hostBound: true,
      });
```

The memory-capture push (missing branch):

```ts
      heartbeats.push({
        agentId: "executive-memory",
        lastEvidenceAt: null,
        evidenceSource: "memory-capture file (missing)",
        hostBound: true,
      });
```

- [ ] **Step 4: Keep the gatherer's cloud evidence cloud (no change needed, but make it explicit)**

In `src/sentinel/heartbeat-gatherer.ts`, the Worker self-beat and read-model `raw` records must NOT set `hostBound` (they are cloud). They already don't — leave them. The `localRunner` evidence is passed through verbatim, so a local runner that sets `hostBound: true` on its `RawEvidence` is honored automatically. No code change is required here beyond confirming the read-model/Worker records stay host-bound-free. (This step is a verification, not an edit.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build && node --test "dist/tests/sentinel-host.test.js" "dist/tests/sentinel-heartbeat.test.js"`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sentinel/sentinel-host.ts tests/sentinel-host.test.ts tests/sentinel-heartbeat.test.ts
git commit -m "feat(sentinel): local artifact/memory evidence is host-bound; cloud stays cloud

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Bridge — suppress per-agent cards when offline; emit one calm ack card

**Files:**
- Modify: `src/wolverine/sentinel-wolverine-bridge.ts`
- Test: `tests/sentinel-wolverine-bridge.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/sentinel-wolverine-bridge.test.ts` inside `describe("sentinelWolverineProposals", ...)` (the `v`, `fleet`, `NOW` helpers exist at the top of the file):

```ts
  it("host-offline: emits ZERO per-agent cards and ONE calm acknowledgement card", () => {
    const f: FleetLiveness = {
      ...fleet([
        v({ agentId: "research", displayName: "Research Agent", state: "down", offlineExpected: true }),
        v({ agentId: "beezulbub", displayName: "Beezulbub", state: "stale", offlineExpected: true }),
      ]),
      hostOffline: {
        since: "2026-06-13T00:00:00.000Z",
        ageHours: 58,
        agents: ["Research Agent", "Beezulbub"],
        reason: "the host appears to have been offline",
      },
    };
    const out = sentinelWolverineProposals(f, NOW);
    assert.equal(out.length, 1);
    const card = out[0]!;
    assert.equal(card.id, "wolverine-host-offline");
    assert.equal(card.riskLevel, "low");
    assert.equal(card.status, "pending_approval");
    assert.equal(card.executable, false);
    assert.ok(card.expiresAt, "ack card auto-expires");
    assert.ok(/offline/i.test(card.title));
  });

  it("host-offline ack card id is stable (idempotent upsert)", () => {
    const f: FleetLiveness = {
      ...fleet([v({ agentId: "research", state: "down", offlineExpected: true })]),
      hostOffline: { since: null, ageHours: null, agents: ["Research Agent"], reason: "offline" },
    };
    const a = sentinelWolverineProposals(f, NOW)[0]!;
    const b = sentinelWolverineProposals(f, "2026-06-15T00:00:00.000Z")[0]!;
    assert.equal(a.id, b.id);
    assert.equal(a.id, "wolverine-host-offline");
  });

  it("a down agent flagged offlineExpected is NOT raised as a per-agent investigation", () => {
    // hostOffline unset here ⇒ only the per-agent path runs; the offlineExpected verdict is skipped.
    const out = sentinelWolverineProposals(
      fleet([v({ agentId: "research", state: "down", offlineExpected: true })]),
      NOW,
    );
    assert.equal(out.length, 0);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test "dist/tests/sentinel-wolverine-bridge.test.js"`
Expected: the 3 new cases FAIL (offlineExpected still produces a per-agent card; no ack card exists). Pre-existing cases PASS.

- [ ] **Step 3: Skip offlineExpected in `isAlertable`**

In `src/wolverine/sentinel-wolverine-bridge.ts`, update `isAlertable`:

```ts
/** Only expected-live agents that are actually down/stale — and not a known host-offline silence. */
function isAlertable(v: LivenessVerdict): boolean {
  if (v.offlineExpected) return false;
  return (v.state === "down" || v.state === "stale") && (v.catalogStatus === "live" || v.catalogStatus === "partial");
}
```

- [ ] **Step 4: Emit the calm ack card**

In `src/wolverine/sentinel-wolverine-bridge.ts`, add a small ISO helper near the top (below the imports):

```ts
/** now + hours as ISO, or null when `now` is unparseable (stays pure — no clock). */
function isoPlusHours(now: string, hours: number): string | null {
  const ms = Date.parse(now);
  return Number.isFinite(ms) ? new Date(ms + hours * 36e5).toISOString() : null;
}
```

Then, in `sentinelWolverineProposals`, after the `for (const v of verdicts) { ... }` loop and before `return out;`, append:

```ts
  if (fleet?.hostOffline) {
    const note = fleet.hostOffline;
    out.push({
      id: "wolverine-host-offline",
      domain: "system",
      actionType: "sync_repair_plan",
      title: note.since
        ? `Fleet was quiet — host offline since ${note.since} (no action needed)`
        : "Fleet was quiet — host appears offline (no action needed)",
      description:
        `Sentinel saw every host-bound agent go silent together (${note.agents.length}: ${note.agents.join(", ")}). ` +
        `${note.reason} No per-agent investigations were raised. Authorize to dismiss; nothing executes.`,
      sourceIntent: "sentinel:liveness:host-offline",
      proposedPayload: { since: note.since, ageHours: note.ageHours, quietAgents: note.agents },
      expectedEffect:
        "Acknowledge that the fleet was quiet because the host was offline. Advisory — no repair, nothing to execute.",
      riskLevel: "low",
      requiredApproval: "Hart",
      status: "pending_approval",
      executable: false,
      blockedReason: "Informational host-offline notice — there is nothing to repair; the silence was expected.",
      expiresAt: isoPlusHours(now, 48),
      safetyNotes: [
        "Raised in place of per-agent 'down' findings when Sentinel inferred the host was simply offline.",
        "Advisory: authorizing only dismisses this notice; nothing executes.",
      ],
      dryRunResult: null,
      createdAt: now,
      updatedAt: now,
      auditEvents: [{ at: now, event: "created", detail: "Sentinel→Wolverine: host-offline (fleet quiet)" }],
      tier: "T0",
      targetId: "host",
      targetName: "Host (Hart's machine)",
      beforeState: { hostOfflineSince: note.since },
      afterState: {},
      rollbackOrCorrectionNote:
        "Advisory only; nothing to roll back. Auto-expires, or dismiss by authorizing/rejecting.",
    });
  }
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build && node --test "dist/tests/sentinel-wolverine-bridge.test.js"`
Expected: all cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/wolverine/sentinel-wolverine-bridge.ts tests/sentinel-wolverine-bridge.test.ts
git commit -m "feat(wolverine): one calm host-offline card replaces N down-investigate synapses

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Detector — skip offlineExpected verdicts

**Files:**
- Modify: `src/wolverine/detectors/agent-liveness.ts`
- Test: `tests/wolverine-agent-liveness.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `tests/wolverine-agent-liveness.test.ts` inside `describe("detectAgentLiveness", ...)`:

```ts
  it("does NOT raise findings for agents whose silence is host-offline (offlineExpected)", () => {
    // Two host-bound agents, both stale ⇒ host-offline gate flags them offlineExpected.
    const fleet = fleetWith([
      { agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true },
      { agentId: "beezulbub", lastEvidenceAt: hoursAgo(50), evidenceSource: "beezulbub-reports/", hostBound: true },
    ]);
    const findings = detectAgentLiveness({ now: NOW, fleetLiveness: fleet });
    assert.ok(!findings.some((f) => f.id.startsWith("agent-liveness:research")), "research suppressed");
    assert.ok(!findings.some((f) => f.id.startsWith("agent-liveness:beezulbub")), "beezulbub suppressed");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run build && node --test "dist/tests/wolverine-agent-liveness.test.js"`
Expected: FAIL (research/beezulbub still surface as findings).

- [ ] **Step 3: Skip offlineExpected in the detector loop**

In `src/wolverine/detectors/agent-liveness.ts`, in the `for (const v of fleet.verdicts)` loop, add a guard right after the existing `if (v.state === "up") continue;` line:

```ts
    if (v.state === "up") continue;
    // Host was simply off ⇒ this silence is expected, surfaced once as a calm note elsewhere. Skip.
    if (v.offlineExpected) continue;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run build && node --test "dist/tests/wolverine-agent-liveness.test.js"`
Expected: all cases PASS.

- [ ] **Step 5: Commit**

```bash
git add src/wolverine/detectors/agent-liveness.ts tests/wolverine-agent-liveness.test.ts
git commit -m "feat(wolverine): agent-liveness detector skips host-offline (expected) silences

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Alert policy — don't page for a powered-off host; keep it logged

**Files:**
- Modify: `src/sentinel/sentinel-heartbeat.ts`
- Test: `tests/sentinel-heartbeat.test.ts`

- [ ] **Step 1: Write the failing tests**

Add to `tests/sentinel-heartbeat.test.ts` inside `describe("heartbeat alert policy", ...)`:

```ts
  it("does NOT alert when every down/stale agent is host-offline (expected)", () => {
    const f = fleet([
      { agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true },
      { agentId: "beezulbub", lastEvidenceAt: hoursAgo(50), evidenceSource: "beezulbub-reports/", hostBound: true },
    ]);
    assert.ok(f.hostOffline, "fixture is a host-offline fleet");
    assert.equal(heartbeatShouldAlert(f), false);
  });

  it("STILL alerts when the host is on and an agent is organically stale", () => {
    const f = fleet([
      { agentId: "research", lastEvidenceAt: hoursAgo(1), evidenceSource: "research-reports/", hostBound: true },
      { agentId: "beezulbub", lastEvidenceAt: hoursAgo(40), evidenceSource: "beezulbub-reports/", hostBound: true },
    ]);
    assert.equal(f.hostOffline, null);
    assert.equal(heartbeatShouldAlert(f), true);
  });

  it("heartbeatLogLine notes the host-offline condition for observability", () => {
    const f = fleet([
      { agentId: "research", lastEvidenceAt: hoursAgo(40), evidenceSource: "research-reports/", hostBound: true },
    ]);
    assert.match(heartbeatLogLine(f), /host offline/i);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run build && node --test "dist/tests/sentinel-heartbeat.test.js"`
Expected: the first new case FAILS (current `heartbeatShouldAlert` returns true on any stale via counts); the log-line case FAILS (no host-offline text). The "STILL alerts" case PASSES already.

- [ ] **Step 3: Make `heartbeatShouldAlert` ignore offlineExpected**

In `src/sentinel/sentinel-heartbeat.ts`, replace the body of `heartbeatShouldAlert`:

```ts
/** Fire only on a REAL freshness failure (down/stale) that is NOT a known host-offline silence. */
export function heartbeatShouldAlert(fleet: FleetLiveness): boolean {
  return fleet.verdicts.some((v) => (v.state === "down" || v.state === "stale") && !v.offlineExpected);
}
```

- [ ] **Step 4: Note host-offline in the log line**

In `src/sentinel/sentinel-heartbeat.ts`, update `heartbeatLogLine` to append a host-offline suffix:

```ts
export function heartbeatLogLine(fleet: FleetLiveness): string {
  const c = fleet.counts;
  const offline = fleet.hostOffline
    ? ` · host offline since ${fleet.hostOffline.since ?? "unknown"} (${fleet.hostOffline.agents.length} agent(s) quiet — expected)`
    : "";
  return `[sentinel-heartbeat] ${fleet.overall} — up ${c.up} stale ${c.stale} down ${c.down} unknown ${c.unknown} (of ${c.assessed}) · ${fleet.overallReason}${offline}`;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run build && node --test "dist/tests/sentinel-heartbeat.test.js"`
Expected: all cases PASS.

- [ ] **Step 6: Commit**

```bash
git add src/sentinel/sentinel-heartbeat.ts tests/sentinel-heartbeat.test.ts
git commit -m "feat(sentinel): alert policy ignores host-offline silence; log line records it

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Full build + suite green

**Files:** none (verification)

- [ ] **Step 1: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 2: Full test suite**

Run: `npm test`
Expected: build succeeds and every `dist/tests/*.test.js` passes — including the pre-existing
`sentinel-liveness`, `sentinel-heartbeat`, `wolverine-agent-liveness`, and `sentinel-wolverine-bridge`
suites (no regressions), plus the new `sentinel-evidence-model` and `sentinel-host` suites.

- [ ] **Step 3: Manual sanity (optional, host-only)**

If a local proposal DB is configured and the Sentinel→Wolverine pass is armed
(`HARTOS_ALLOW_SENTINEL_WOLVERINE=true`, kill-switch off), run the pass after the machine has been
off long enough that local artifact dirs are stale:

Run: `node --import tsx scripts/run-sentinel-wolverine-pass.ts` (or the project's configured runner)
Expected: log reports one `wolverine-host-offline` card, not N `wolverine-liveness-*` cards.

- [ ] **Step 4: No commit needed** (verification only). If any fix was required, commit it with a
  `fix(sentinel): ...` message ending in the `Co-Authored-By` trailer.

---

## Self-review notes

- **Spec coverage:** components 1–6 of the spec map to Tasks 1, 3, 2, 4, 5, 6 respectively; the
  reconciliation (single `pending_approval` ack card with `expiresAt`, stable id) is Task 4; the
  "logged, not silently dropped" honesty point is Task 6 (log line) + Task 1 (`describeFleetLiveness`).
- **Backward compatibility:** all new interface fields are optional, so the hand-built `FleetLiveness`
  / `LivenessVerdict` fixtures in existing tests keep compiling; `assessFleetLiveness` always populates
  concrete values.
- **Type consistency:** `hostBound`, `offlineExpected`, `HostOfflineNote { since, ageHours, agents,
  reason }`, and `FleetLiveness.hostOffline` are named identically everywhere they appear.
- **Accepted limitation** (agent already stuck before shutdown is folded into the note, then
  self-heals) is covered by the Task 1 "host-on" test proving organic-while-up still fires.
