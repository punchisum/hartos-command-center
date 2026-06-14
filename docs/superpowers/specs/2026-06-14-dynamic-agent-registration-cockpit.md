# Dynamic Agent Registration + Truth-Driven Cockpit (Design)

**Date:** 2026-06-14
**Status:** Design — capturing Hart's ratified constitutional requirement before building
**Supersedes:** the static hand-maintained `meta-agent-registry.ts` CATALOG as the cockpit's source of agent truth (the CATALOG becomes a bootstrap seed only).

---

## The constitutional requirement (Hart, 2026-06-14)

The cockpit must be a **visualization of the source of truth, not a manually-maintained dashboard.**

1. New agents publish an **Agent Manifest / registry entry** after approval.
2. The cockpit renders agents from the **registry + read-models dynamically**, never from hardcoded cards.
3. Agent status is **live**: health, last heartbeat, capability summary, current tier, **arming state**, proposal/execution permissions, latest activity, known risks.
4. Nothing appears **"live"** unless its source-of-truth record AND health/read-model confirm it.
5. **Synapse approval** (the Council/approval gate) is the gate before an agent becomes an official HartOS citizen.
6. A scaffolded-but-unapproved agent shows as **draft / pending / offline** — never silently hidden, never faked live.
7. Follows the **Truth Layer**: cockpit = visualization of source of truth.

This is now a doctrine clause (to be ratified into `src/doctrine/doctrine.ts`): *"The cockpit renders the live registry + read-models; an agent is 'live' only when its manifest is Synapse-approved AND its health read-model confirms it. Status is derived, never authored."*

---

## Current state (the gap)

- `src/agents/meta-agent-registry.ts` is a **hardcoded `CATALOG`** of ~20 agents with hand-set `status` fields. Badges go stale and can claim `"live"` without health confirmation (violates #2, #4).
- The Factory (`src/agents/factory*`, `council-factory-bridge.ts`) builds agents but does **not** write any registry record on approval (violates #1).
- The cockpit v5 deck (`cloudflare-cockpit-v5.ts`) renders from `reg.agents` (the static catalog) mapped to badges (violates #2).
- Sentinel liveness (`src/sentinel/*`) IS a real read-model but only feeds the fleet-health number, not per-agent badges (#3 partially unmet).
- **Stopgaps already landed 2026-06-14** (explicitly temporary, to be replaced by this design): fleet-health composite; Factory/Wolverine/Beezulbub baseline→`"live"` + kill-switch downgrade. These make the static view less wrong but do NOT satisfy #2/#4.

---

## Design

### 1. The Agent Manifest (source-of-truth record)

A durable record per agent, written on Synapse approval, read by the cockpit. Stored in the **cockpit Supabase project** (`xbuinrnpfjltimofwrdx`) as table `agent_registry` (mirrors the `cockpit_proposals` spine: Node writes with an elevated role; the Worker reads via a read-only anon RPC).

```ts
interface AgentManifest {
  agentId: string;                 // stable slug
  displayName: string;
  capabilitySummary: string;       // one line
  parentId: string | null;         // org hierarchy
  tier: "T0".."T6";                // autonomy tier
  lifecycle: "draft" | "pending_approval" | "approved" | "provisioning" | "live" | "retired";
  permissions: { propose: boolean; execute: boolean };  // proposal/execution permissions
  armingFlag: string | null;       // the env flag that arms its hands (e.g. HARTOS_ALLOW_SELF_MOD)
  sourceProposalId: string | null; // the build_agent_plan proposal that created it
  knownRisks: string[];
  createdAt: string; approvedAt: string | null; retiredAt: string | null;
}
```

`lifecycle` is the authored part (set by the build/approval pipeline). **`status` is NOT stored** — it is *derived* at read time (see §3).

### 2. Registration flow (Synapse approval = the gate)

```
Factory builds agent  → build_agent_plan proposal (pending_approval)   [lifecycle: draft]
Hart/Synapse approves → manifest written, lifecycle = approved          [#5 gate]
Provisioning runs     → lifecycle = provisioning → live (on success)
Health read-model     → confirms "live" badge ONLY if heartbeat fresh   [#4]
```

- On approval of a `build_agent_plan` proposal, the daemon's bridge writes/updates the `agent_registry` row (lifecycle `approved`).
- A scaffolded-but-unapproved agent has a `draft` manifest (or none) → cockpit shows **draft/pending**, never hidden (#6).
- Retiring/disarming flips lifecycle, never deletes (audit).

### 3. Truth-derived status (the core of #3, #4)

The cockpit computes each agent's **displayed status** purely from truth, never from a stored constant:

```
displayedStatus(agent) =
  if lifecycle in {draft, pending_approval}        → "draft"/"pending"
  else if lifecycle == provisioning                → "provisioning"
  else if killSwitchOn && agent.permissions.execute→ "disarmed"
  else if liveness(agent).state == "up"            → "live"      // health-confirmed (#4)
  else if liveness(agent).state in {stale,unknown} → "watch"     // approved but unconfirmed
  else                                              → "offline"
```

Each rendered card shows: health (from Sentinel liveness), **last heartbeat** (`lastEvidenceAt`), capability summary, tier, **arming state** (flag + on/off), **permissions** (propose/execute), latest activity (last proposal/execution for that agentId from the proposal/audit spine), and known risks (manifest). All sourced; nothing authored as "live".

### 4. Cockpit renders dynamically (#2, #7)

- New read-model `agentRegistryView(manifests, liveness, proposals, env)` → pure, joins manifest + Sentinel liveness + latest activity + arming → `RenderedAgent[]`.
- `GET /api/agents` and the v5 deck render from `agentRegistryView`, replacing the static `reg.agents` mapping.
- The 10 core "organ" agents are **seeded** as manifests (bootstrap migration from today's CATALOG) so nothing regresses; from then on every Factory-built agent adds a row. The CATALOG is retired to a seed file.

### 5. Migration / phasing

- **Phase A** — manifest schema + `agent_registry` table + read-by RPC; seed the 10 organs from CATALOG; `agentRegistryView` pure builder + tests. Cockpit reads the seeded registry (behavior identical to today, but now truth-shaped).
- **Phase B** — derive status from liveness + arming + lifecycle (replaces the hardcoded badges + the 2026-06-14 stopgaps); draft/pending/offline states.
- **Phase C** — Factory writes a manifest on Synapse approval (close the loop: build → approve → register → appear live only when healthy).
- **Phase D** — per-card live fields (heartbeat, latest activity, risks, permissions) + the doctrine clause ratified.

Each phase is independently shippable and truth-preserving.

## Doctrine compliance

- **Truth Layer / control-surface rule:** status/health/verdict are **computed** from source of truth; the LLM/UI only visualizes ([[cockpit-control-surface-rule]]).
- **Synapse gate:** registration requires approval (#5) — reuses the existing propose→approve spine; propose-only until approved.
- **Fail-closed:** absent/unconfirmed health ⇒ never "live" (#4); unapproved ⇒ draft/pending, never hidden (#6).

## Decisions (locked with Hart, 2026-06-14)

1. **Registry store = a new `agent_registry` Supabase table** in the cockpit project (Node writes elevated, Worker reads via anon RPC) — NOT overloaded onto `cockpit_proposals`.
2. **Synapse approval = the existing proposal approval gate** — approving the agent's `build_agent_plan` proposal writes the manifest as `approved`. No separate council vote.
3. **Stopgaps stay** (fleet-health composite; Factory/Wolverine/Beezulbub→live + kill-switch downgrade) and are superseded by Phase B.
4. **Sequencing:** finish the two in-flight cockpit fixes (Sentinel→Wolverine auto-alert; the approved-work "Building" tracker) FIRST, then build this design Phase A→D.

🤖 Designed with [Claude Code](https://claude.com/claude-code)
