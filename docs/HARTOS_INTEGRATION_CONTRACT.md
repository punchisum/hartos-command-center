# HartOS Integration Contract (v0 — DESIGN)

**Status:** DESIGN DRAFT. **Do not implement yet.** Implement only *after* the trust ladder is proven end-to-end — i.e. after **P4 (rollback)** is armed and **P5 (the first real armed agent, fitness)** is live. Standardizing a pattern that isn't battle-tested is reactive patching wearing a nicer hat.

**Companion to** [HARTOS_BASELINE.md](HARTOS_BASELINE.md) + [HARTOS_EXECUTION_PLAN.md](HARTOS_EXECUTION_PLAN.md). This **extends the existing Factory Officiation Contract** — it is NOT a new system.

---

## Why this exists

Every future HartOS member — a new agent, a service, a website, any external surface — should plug into the ecosystem **seamlessly**, *and* be structurally incapable of becoming "theater" (claiming live/working when it isn't, the exact disease the 2026-06-12 audit found). This contract is that interface.

**The core principle:** a member integrates **seamlessly as advisory** (free), and **earns hands** (gated). *Integration ≠ authority.* "Seamless" must never quietly mean "auto-granted hands" — that would erase the human-approval floor.

---

## Two tiers

### Tier A — Universal (every member, mandatory, cheap)
1. **Self-describing capability manifest** (machine-readable): `id`, `name`, what-it-does, `domain` (inside/outside the fence), `tier`, `evidenceSource`, `dependsOn[]`, `contractVersion`.
2. **Evidence / heartbeat:** emits "last successful run" evidence the truth layer reads. **Status is COMPUTED from evidence, never asserted.** No evidence ⇒ `unknown`, never assumed up.
3. **Born advisory / read-only.** No hands at birth.
4. **Definition of done = observable as live in the truth layer.** If you can't see it true there, it isn't done.
5. **Registered in the capability registry** under "real-and-used-or-deleted." Unused capabilities are sunset, not left to rot.

### Tier B — Earned hands (opt-in, gated)
A member climbs into Tier B **only** by passing:
1. **The fence test:** does a mistake stay inside the fence (the member's own domain or the system itself)? If no → it stays advisory forever. *Money and comms NEVER get hands.*
2. **The trust ladder, in order:** truth layer → reliable approve→execute (post-exec verify) → **rollback** → autonomous. No skipping rungs; rollback must work before any autonomy.
3. **Every hands-capability must carry:** a fail-closed **gate**, an **idempotency key**, an append-only **audit** trail, an **inverse-op declared at design time** (rollback is data, not a guess), an **arming flag that defaults OFF**, and it inherits the global **kill switch** + a **scope guard** (what it may touch).

---

## The member lifecycle (the Factory enforces this)

```
spec → Officiator (ADMIT/REVISE/REJECT) → Simulator (prove the boundary bites)
   → BORN ADVISORY (Tier A: manifest + evidence + registered, read-only)
   → fence test + climb the trust ladder
   → EARN HANDS (Tier B) → arm (flag ON, explicit human approval) → LIVE (observable in the truth layer)
```

---

## Reusable building blocks (already built — reuse, don't reinvent)

| Need | Use |
|---|---|
| Computed status from evidence | `src/sentinel/evidence-model.ts`, `heartbeat-gatherer.ts`, `src/truth-layer/truth-layer-api.ts` (`computeFleetVerdict`, `fleetHealthPercent`), `truth-layer-persist.ts` |
| Fail-closed gates | `src/doctrine/execution-gate.ts`, `rollback-gate.ts`, `amendment-gate.ts`; `src/execution/self-mod-scope-guard.ts` |
| Post-exec verification | `src/execution/execution-verification.ts`, `verification-input.ts` |
| Capability registry + provenance | `src/beezulbub/capability-registry.ts`, `provenance-ledger.ts` |
| Idempotency + audit | `src/lib/idempotency-key.ts`, the append-only `cockpit_proposal_audit` table |
| Autonomy classification / fence | `src/cockpit/decision-engine.ts` (`decide`, Tier 0–4, `baseTierFor`) |

---

## For websites & external surfaces

A website is a **Tier-A consumer**: it READS the truth layer + capability manifests (evidence-honest, read-only) and **renders any member from its manifest** — no bespoke per-member UI. Presentation is decoupled from members. This directly kills the "bespoke cockpit page = theater" risk the audit flagged: a surface can only show what the truth layer actually computes.

---

## Design upgrades to fold in (when implementing)

1. **Self-describing render contract** — the cockpit/website auto-renders a member from its manifest. No hand-built page per agent (hand-built pages drift into theater).
2. **Contract-conformance CI gate** — mirror `doctrine-conformance.test.ts`: a new member fails CI unless it satisfies Tier A (has a manifest + an evidence source, status not hand-asserted).
3. **Capability sunset** — unused > N days ⇒ flagged ⇒ demoted ⇒ removed. Theater can't accumulate; the registry stays honest by construction.
4. **Capability dependency graph** — `dependsOn[]` lets the truth layer show cascade health ("ops is down because its read-model is stale").
5. **Versioned contract** — members declare `contractVersion`; the Factory validates against the live version and can require migration.
6. **Reversibility-first** — a capability can't enter Tier B without a declared inverse-op. Forces rollback to be designed in, not bolted on.
7. **Dogfood first** — the Factory *and* the truth layer must themselves satisfy Tier A before they enforce it on others. A theater agent can't credibly birth non-theater agents.
8. **Born-advisory everywhere** — new surfaces (including the website and any future external integration) get read-only access first; writes/hands are a separate, gated step.

---

## Non-negotiables

- **Timing:** implement *after* P4 + P5 prove the ladder. Not before.
- **Extend, don't replace:** build on the Factory's Officiator/Simulator, not a parallel system.
- **Seamless = advisory is free; hands are earned.** Never auto-grant hands.
- **The fence test and the kill switch are universal** — every Tier-B member inherits them, no exceptions.
