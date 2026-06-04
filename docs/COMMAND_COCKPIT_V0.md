# Command Cockpit v0 (Phase 12)

The cockpit is no longer a generic "agent ok" skeleton. It is Hart's command
surface: custom **domain panels** plus a **Command HartOS** router that answers
practical questions from real, read-only context.

Everything here is **local and read-only**. No execution, no mutation, no
deploys, no network beyond the already-governed read-only read-models.

## Architecture (kept separate on purpose)

1. **Product logic / state machine** — pure, deterministic, testable:
   - `src/cockpit/panels/*` — the domain panel contract + builders.
   - `src/cockpit/cockpit-intent-router.ts` — intent detection + grounded answers.
2. **Runtime architecture** — wiring:
   - `src/cockpit/cockpit-read-model.ts` builds panels into `CockpitState`.
   - `src/cockpit/cockpit-orchestrator-bridge.ts` routes each Ask HartOS message
     and attaches the grounded intent answer + panels to the response.
   - `src/cockpit/cockpit-server.ts` serves it locally.
3. **Implementation patch** — rendering:
   - `src/cockpit/cockpit-renderer.ts` renders the three panels and the routed
     intent (server-side and in the live client-side updater).

## 12A — Domain panels

Three panels are rendered in the cockpit and captured in `CockpitState.panels`:

- **Fitness Agent** — configured/detected, calories/protein, today's plan +
  completion, recovery, HRV/RHR/sleep freshness, weekly load, latest workout,
  next adjustment, missing setup.
- **Ops Agent** — configured/detected, urgent items, latest card updates,
  blocked/risk cards, ClickUp sync, pending approvals, DD/analyse reports,
  recent reports, next operational action, missing setup.
- **Factory / Build New Agent** — factory status, available modules,
  registered capabilities, last verification artefact, Beezulbub +
  Orchestrator/CTO availability, suggested next build, build-agent entry
  prompts, missing setup.

### Contract guarantees

- **Never shows fake data.** Unavailable fields render `unknown`,
  `not configured`, or `no data found` — plus the **exact next setup step**.
- Panels carry **source**, **freshness**, and **confidence** where possible.
- Panels are **read-only** and degrade gracefully (no config → still render).

### Data sources (read-only, in priority order)

1. Supabase read-models (`read-models.local.json`, disabled by default).
2. Agent integration read-models (`agent-integrations.local.json`).
3. Local reports + the Beezulbub capability registry (Factory panel).

Phase 12 is useful **without** live Supabase: panels degrade to setup steps.

## 12B — Command HartOS routing

`routeCockpitIntent()` deterministically classifies a request into one of:

| Intent | Example | Answer source |
| --- | --- | --- |
| `system_status` | "What's my system status?" | cockpit + all panels + LLM/read-model status |
| `fitness_status` | "How's recovery?" | Fitness panel summary |
| `ops_status` | "Anything urgent in ops?" | Ops panel (urgent/blocked/latest) |
| `build_agent` | "Create a tax agent" | Factory panel + Orchestrator build plan |
| `improve_agent` | "Improve the fitness agent" | target panel gaps → improvement plan |
| `strategy_review` | "Give me a CTO review" | Orchestrator strategy/CTO + leverage |
| `unknown` | (unmatched) | clarifying question + suggested commands |

- Deterministic and testable. LLM enhancement (Phase 11I gateway) is optional
  and gated; the deterministic router is always the fallback and the source of
  truth for the intent + grounded summary.
- Responses include **data gaps** and **next setup steps** when context is
  missing. The router never invents operational facts.

## Using it

```bash
npm run cockpit:web        # live cockpit + Ask HartOS (localhost only)
npm run cockpit:snapshot   # static HTML snapshot (cockpit-reports/)
npm run cockpit:ask -- --request="What's my system status?"
```

Ask HartOS shows the routed **intent** and a grounded summary first, followed by
the deterministic orchestrator detail. No button executes anything.
