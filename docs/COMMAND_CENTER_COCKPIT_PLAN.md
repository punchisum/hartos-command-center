# Command Center Cockpit Plan (Phase 11G)

> **Orchestrator is the brain. Command Center is a read/control surface.**
> **Phase 11G does not build the cockpit UI.** This is the planning layer that a
> future cockpit will be built against. No provider/Supabase/pack mutation.

## What the cockpit plan provides

`npm run command-center:plan` writes `cockpit-plan-*.md` (+ JSON sidecar) under
`command-center-reports/` containing:

- The single safe, local **next recommended command**.
- Action states grouped as read-only / approval-required / manual-required / forbidden.
- Missing sources (so the UI knows what to degrade).
- The **future cockpit phases** (documented, not built).

## Future cockpit phases (not built in 11G)

| Phase | Title | Description |
| --- | --- | --- |
| `11H_read_only_cockpit` | Read-only cockpit | Render cards from the data contract + read model. View reports only. No actions. |
| `11I_local_action_surface` | Local action surface | Wire read-only + local report actions to existing npm commands. Still no mutation. |
| `11J_approval_workflow` | Approval workflow | Surface approval/manual queues with explicit human gates. No auto-approve. |
| `11K_controlled_mutation` | Controlled mutation (gated) | Only after dedicated safety phases: provider/Supabase/pack actions behind admin approval + audit. |

## Hard boundaries restated

Phase 11G does **not**:

- build frontend UI / web cockpit / Obsidian / Telegram runtime
- mutate Supabase, providers, or packs
- call live GitHub / OpenAI / the network
- auto-generate, auto-implement, or auto-promote packs
- treat skeleton / implementation_draft packs as usable
- execute any provider action

Phase 11G **only** defines contracts, read models, and reports — locally,
deterministically, and testable without internet.
