# HartOS Constitution

The HartOS doctrine is enforced as code (`src/doctrine/doctrine.ts`) and rendered to `DOCTRINE.md`. This Constitution holds the **amendments** — deliberate, ratified changes to a foundational rule. An amendment is in force only when (a) this document records it as ratified, AND (b) its machine-checked arming conditions are met.

## Amendment §6 — Bounded Autonomous Self-Modification

**Status:** RATIFIED 2026-06-14 (Hart). Ratified after the enforcing machinery was built, tested (suite 2892/0), and merged disarmed (PRs #21–#42). Self-mod is armed only when the machine-checked flags below are also set.

### Why
HartOS should be able to fix its own bugs, recalibrate its own logic from its track record, and extend its own capabilities — without a human hand-editing the code each time. §6 grants that, narrowly and reversibly.

### What it amends
The **Human-approval floor** ("Nothing executes without Hart's explicit, per-action approval") is amended to carve a bounded exception: the auto-apply self-mod classes are **pre-authorized** by this ratified amendment + a class flag, and **notify-after** instead of approve-before. Every other action — and the entire public-Worker fence — is unchanged.

### The grant (bounded)
HartOS may modify its own `src/` runtime, under a permanent gauntlet:

- **Armed only** when this §6 is ratified AND `HARTOS_SELFMOD_AMENDMENT_APPROVED=true` AND `HARTOS_ALLOW_SELF_MOD=true` AND `HARTOS_EXECUTION_KILL_SWITCH≠on`. Default OFF.
- **Classes:** *fix* (bug/drift repair) and *recalibrate* (own thresholds/rules) may **auto-apply** — commit → push → CI auto-deploy → notify Hart after. *Extend* (new capabilities) is **propose-only** — it waits for Hart's approval.
- **Blast-radius cap:** an auto-apply change must be small (≤ 5 files AND ≤ 150 changed lines). Over the cap → escalates to propose-only, even a "fix".
- **Always-on gates (every class):** clean git baseline → in-scope only (own runtime; **never** the doctrine, the self-mod machinery, the dispatch/verify/audit spine, the secret detector, mutation adapters, or secrets/deploy config) → the full test suite passes (including this doctrine conformance test) → no secret in the diff → fully reversible.
- **Post-deploy net:** after an auto-deploy, the smoke/health check runs. On failure → auto-revert to the last-good SHA + **disarm self-mod** + Telegram-alert Hart.
- **Circuit breaker:** a post-deploy failure disarms self-mod (Hart re-arms). A rate cap (≤ 1 auto-deploy/hour) bounds a misfiring loop.
- **The kill-switch (`HARTOS_EXECUTION_KILL_SWITCH`) overrides everything, always.**

### What it does NOT touch
The public Cloudflare Worker stays permanently execution-disabled (path a). Self-mod runs only on the trusted local daemon (path b). Breaking the public edge still yields only a read-only dashboard.

### Ratification
To ratify: change **Status** above to `RATIFIED <date>`, then set the two arming flags. The enforcing machinery (the auto-deploy pipeline, post-deploy net, classifier, circuit breaker) MUST be built and tested before ratification — do not arm a grant whose guardrails do not yet exist in code.

---

🤖 Drafted with [Claude Code](https://claude.com/claude-code)
