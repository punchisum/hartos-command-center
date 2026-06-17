# Wolverine host-offline inference — design

**Date:** 2026-06-17
**Status:** Design (awaiting Hart's review)
**Author:** brainstormed with Claude

## Problem

When Hart powers off his computer, every agent that depends on a local runner stops
producing evidence. Sentinel computes liveness purely from evidence age
([`src/sentinel/sentinel-liveness.ts`](../../../src/sentinel/sentinel-liveness.ts) — `ageHours <= staleHours ? up : ageHours <= downHours ? stale : down`).
After the stale/down thresholds elapse, **every** host-bound agent crosses into
`down`/`stale` at once. The local `run-sentinel-wolverine-pass` then mints one
advisory FixProposal per agent via `sentinelWolverineProposals`
([`src/wolverine/sentinel-wolverine-bridge.ts`](../../../src/wolverine/sentinel-wolverine-bridge.ts)),
and the cockpit Synapses board shows them as "Wolverine: X is down — investigate"
(the 6 cards in the reported screenshot).

None of those are organic failures. They are the predictable consequence of the
machine having been off. Wolverine should be able to tell the two apart and stay
quiet when the cause is simply "the computer was off."

## Core insight

An organic failure and a power-off have **different signatures**, and the signal to
distinguish them already exists in the system:

- Evidence is either **host-bound** (a local artifact dir / memory file on Hart's
  machine — goes dark the instant the PC is off) or **cloud** (the answering Worker,
  Supabase read-models — always on).
- The *newest* heartbeat among host-bound agents is a proxy for **"when the host was
  last demonstrably on."**

Therefore:

- **Newest host-bound evidence is fresh** (age ≤ `staleHours`) → the machine was on,
  so an individual silent agent is **organic** → fire the synapse. *(unchanged)*
- **Newest host-bound evidence is itself stale** (age > `staleHours`, or nothing
  host-bound is fresh) → the whole host was quiet/off → every host-bound silence is
  **expected** → suppress those synapses, surface one calm note.

This is self-correcting: once Hart boots back up and the runners produce fresh
evidence, the host reads "on" again, and any agent that is *genuinely* stuck (silent
while its host-peers freshened) surfaces as an organic finding on the next pass.

### Why this is honest, not a guess

- "Host-bound vs cloud" is a property of the **evidence source**, set by the edge that
  actually read it — not inferred. `gatherLocalHeartbeats` reads local artifact dirs ⇒
  host-bound; the Worker's self-evidence and read-model snapshots ⇒ cloud.
- The gate only ever fires when **no** host-bound evidence is fresh. If even one
  host-bound agent is fresh, the host is "on" and every other host-bound silence is
  treated as organic (fires normally). No masking of real failures while the host is up.
- The in-Worker path has **zero** host-bound evidence (cockpit self-beat + read-models
  are all cloud), so the Worker can never falsely declare the PC off.

### Known, accepted limitation

If an agent was *already* organically behind before a shutdown (e.g. Beezulbub silent
100h while peers were silent 28h), the host-offline gate folds it into the calm note
for the duration of the offline window. This is the right call — don't nag while the
machine is off. It self-heals: when the host comes back and peers freshen, the still-
stuck agent reads as silent-against-fresh-peers and surfaces organically. (Logged, not
silently dropped — see component 6.)

## Decisions (from brainstorming)

1. **Detection** — infer from the fleet (newest host-bound evidence). No new
   infrastructure; reuses the evidence sources already gathered.
2. **Behavior on host-offline** — one calm note instead of N "investigate" synapses.
3. **Where the calm note lives** — one informational entry in the proposal store /
   Synapses panel (see reconciliation below).

### Reconciliation: the v5 board is approval-only

`src/runtime/cloudflare-cockpit-v5.ts` (lines ~415–419) renders the Synapses board
from **only** `status === "pending_approval"`; every other status is hidden by design.
There is no separate "informational, visible, non-actionable" lane in the board.

The faithful realization of "one calm note in the proposal store + panel" is therefore
**a single `pending_approval` acknowledgement card**:

- Title/copy framed calmly and non-alarming, e.g.
  *"Fleet was quiet — host offline since `<since>`. No action needed; authorize to dismiss."*
- `riskLevel: "low"`, `executable: false`, advisory.
- `expiresAt` set (e.g. +48h) so it **auto-resolves** even if Hart never touches it.
- Stable id (`wolverine-host-offline`) so re-running the pass upserts exactly **one** row
  — never a pile.
- "Authorize" on this card means *dismiss*; nothing executes (consistent with all
  Sentinel→Wolverine advisories, which are `executable: false`).

**Open for Hart at review:** if you'd rather the note not touch the approval board at
all, the alternative is a calm status line on the Overview (a tiny persisted
host-offline status row the Worker renders) — bigger change, keeps the approval queue
100% clean. Default in this spec is the single acknowledgement card.

## Components

All core logic is pure + deterministic (no clock, no I/O — `now` injected), matching the
existing Sentinel doctrine, and fully unit-testable.

### 1. `src/sentinel/sentinel-liveness.ts` (pure core — the heart)

- `AgentHeartbeat` gains `hostBound?: boolean`.
- `LivenessVerdict` gains `hostBound: boolean` and `offlineExpected?: boolean`.
- New `HostOfflineNote` interface: `{ since: string | null; ageHours: number | null;
  agents: string[]; reason: string }`.
- `FleetLiveness` gains `hostOffline: HostOfflineNote | null`.
- In `assessFleetLiveness`, after folding verdicts:
  - carry `hostBound` from each heartbeat onto its verdict (default `false`);
  - compute `hostLastSeenMs` = newest parseable `lastEvidenceAt` among `hostBound`
    verdicts;
  - if there is at least one `hostBound` verdict AND (`hostLastSeenMs` is absent OR its
    age > `staleHours`): mark every `hostBound` verdict whose state is `down`/`stale`
    with `offlineExpected = true`, and build the `HostOfflineNote` (since =
    host-last-seen ISO or null, agents = their display names, reason = calm sentence);
  - otherwise `hostOffline = null` and no verdict is flagged.
- `heartbeatsFromReadModels` leaves all its heartbeats **not** host-bound.
- `describeFleetLiveness` prints one calm line when `hostOffline` is set, instead of a
  wall of `DOWN`s.

### 2. `src/sentinel/sentinel-host.ts`

`gatherLocalHeartbeats` tags every heartbeat it produces `hostBound: true` (artifact
dirs + the memory-capture file are all host-produced).

### 3. `src/sentinel/heartbeat-gatherer.ts` + `src/sentinel/evidence-model.ts`

Carry `hostBound` through: `RawEvidence` gains optional `hostBound`; `normalizeEvidence`
preserves it; the gatherer marks the Worker self-beat and read-model snapshots as **not**
host-bound, and `localRunner` evidence keeps whatever it was passed (host-bound when the
local runner sets it).

### 4. `src/wolverine/sentinel-wolverine-bridge.ts`

`isAlertable(v)` returns `false` when `v.offlineExpected` is set → the per-agent
"investigate" synapses are never minted while the host is offline. Add a small builder
(or extend `sentinelWolverineProposals`) that, when `fleet.hostOffline` is set, emits the
**one** calm acknowledgement card described in the reconciliation section (stable id,
low risk, `expiresAt`, calm copy). Still pure; `now` injected.

### 5. `src/wolverine/detectors/agent-liveness.ts`

`detectAgentLiveness` skips verdicts where `offlineExpected` is set (no audit finding
either) — keeps the Wolverine audit queue clean for the same reason.

### 6. `src/sentinel/sentinel-heartbeat.ts`

- `heartbeatShouldAlert` ignores `offlineExpected` verdicts (no RED Telegram alarm for a
  powered-off PC).
- `buildHeartbeatAlert` (and/or `heartbeatLogLine`) carries the calm host-offline summary
  so the offline window is still **logged** (honest: nothing is silently dropped).

## Data flow (after change)

```
local pass (run-sentinel-wolverine-pass)
  → resolveMetaAgentRegistry
  → gatherLocalHeartbeats         [hostBound: true on every local beat]
  → assessFleetLiveness           [host-offline gate → offlineExpected + fleet.hostOffline]
  → sentinelWolverineProposals
        host on  → one card per organic down/stale agent      (unchanged)
        host off → ZERO per-agent cards + ONE calm ack card    (new)
  → proposal store (idempotent upsert by stable id)
  → cockpit Synapses board (pending_approval only)
```

## Testing

Pure-core unit tests (extend `tests/sentinel-liveness.test.ts`,
`tests/wolverine-agent-liveness.test.ts`, `tests/sentinel-heartbeat.test.ts`,
`tests/sentinel-wolverine-bridge.test.ts`):

1. **Host off** — all host-bound beats older than `staleHours` ⇒ every host-bound
   down/stale verdict flagged `offlineExpected`; `fleet.hostOffline` populated; bridge
   emits zero per-agent cards + exactly one ack card; `heartbeatShouldAlert` false.
2. **Host on, one agent organic** — one host-bound beat fresh, another down ⇒
   `hostOffline` null; the down agent flagged organic and fires a card (unchanged
   behavior); `heartbeatShouldAlert` true.
3. **Cloud-only (in-Worker) path** — `heartbeatsFromReadModels` ⇒ no host-bound
   verdicts ⇒ gate never triggers; behavior identical to today.
4. **Idempotency** — running the pass twice while host-offline upserts the same single
   ack card (stable id), not two.
5. **Self-heal** — host comes back, peers fresh, one agent still stale ⇒ that agent
   surfaces organically again.

## Out of scope

- An explicit always-on host heartbeat producer (considered; rejected for now — the
  fleet-inference signal is sufficient and needs no new infra). The `hostBound` seam
  leaves room to add one later without reworking the gate.
- Changing the `unknown`-state handling or the in-Worker liveness display.
- The Overview status-banner alternative (only built if Hart redirects at review).
