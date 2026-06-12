# HartOS Baseline v1

**Date:** 2026-06-12 · **Status:** APPROVED (Hart) · **Authority:** This is the north star. Every future change is measured against it. Where ad-hoc direction conflicts with this doc, this doc wins until explicitly amended.

Derived from a 15-question vision interrogation + tiebreakers (2026-06-12). It exists to end reactive symptom-patching by giving every patch a target to be measured against.

---

## 1. What HartOS is
A **life-OS Hart lives inside**. Its job: help Hart **make better decisions**, and **act for him** in domains where a mistake can't hurt anyone but him or the system itself. Not a product, not a demo.

- Primary classification: **life-OS**. (The CoachOS product spin-out is explicitly *secondary* and out of scope for this baseline — revisit only after the core is bulletproof.)

## 2. Success signal
**Better decisions per week**, plus **earned trust to act inside the fence.** (Hours-saved and peace-of-mind are real but secondary.)

## 3. The doctrine — "Hands inside the fence, advice outside it"
This replaces the prior "automatic eyes, gated hands."

- 🤚 **Hands (acts, then reports):** fitness/training, HartOS's own code.
- 🧠 **Advisory (reasons, Hart decides):** money, comms-in-Hart's-name — and by default **anything with external or irreversible blast radius.**
- **The fence test for any *new* capability:** does a mistake stay inside the fence (Hart or the system only)? **Yes → may earn hands. No → advisory, always.**
- This is principled, not arbitrary. Hart's "no fear" answer is *justified*: the autonomous domains can't harm third parties.

## 4. Capabilities, not a fleet
Drop the 9-agent org framing. HartOS is a **list of capabilities**. Each is **real-and-used or deleted** — no darlings. Every capability's status is **computed from evidence, never asserted.**

## 5. The truth layer is the foundation
One **source of truth** that *introspects the running system* and reports, per capability: deployed commit SHA · actually-armed flags · last successful run · liveness. The cockpit and memory **READ** from it; they may **never assert** state. **Built first; non-negotiable.**

## 6. The trust ladder (how self-modification is earned)
Hart wants full autonomous self-modification ("mean it fully"). It is **the summit, earned by climbing** — no skipping rungs:

1. **Truth layer** — the system can see itself.
2. **Reliable approve→execute** — when Hart says yes, it *verifiably* happens.
3. **Rollback** — it can undo its own changes.
4. **Autonomous self-modification within guardrails** — the summit.

## 7. The domain split (the autonomy spec)

| Domain | Posture | Notes |
|---|---|---|
| Fitness / training | **HANDS** — autonomous, reports after | Load-bearing; advisory today, target autonomous |
| HartOS's own code | **HANDS** — autonomous, guardrailed | The summit; earned via the ladder |
| Money | **ADVISORY** — never acts | Already enforced (Tier 3) |
| Comms in Hart's name | **ADVISORY** — never acts | Already enforced (Tier 3) |
| Anything new | **ADVISORY** by default | Until it passes the fence test |

## 8. Definition of done (the cultural change)
**Done = observable as live in the truth layer.** Not "tests pass locally," not "committed." If you can't see it true in the truth endpoint, it isn't done.

## 9. The 6-month test
A concrete day where: Hart brings problems and HartOS **reasons with him** (partner, outside the fence); meanwhile it **runs his training loop and improves its own code autonomously** (hands, inside the fence); and at any moment Hart can see — *truthfully* — exactly what it did.

## 10. Out of scope for this baseline
- CoachOS product build.
- **Any new capability** until the existing ones are wired into the truth layer (the Phase 2 gate).
- Opening Tier-1 / self-mod autonomy before rungs 1–3 of the trust ladder are proven.
