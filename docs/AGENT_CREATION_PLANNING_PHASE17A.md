# Phase 17A — Cockpit Agent-Creation Planning (dry-run only)

Hart can type "Create a tax agent" (or invoice / trade-ops / …) into the cockpit
and get back a **structured, non-executable plan** — never a created agent.

## Doctrine
- **Propose, don't act.** The output is a non-executable proposal requiring Hart's
  approval. Nothing is created, no provider is called, no code is written.
- **Pure & Worker-safe.** The planner (`src/cockpit/agent-planner/`) has no
  filesystem, network, or provider access, so it runs in the hosted Worker too.
- **Plan-level, not execution.** The exact Factory `AgentConfig` and byte-precise
  scaffold manifest are intentionally **not** produced here — they belong to a
  future EXECUTION phase that runs with the Agent Factory. This avoids forking
  Factory artifacts into Command Center (the drift class 16E just resolved).

## Flow
```
Cockpit Ask: "Create a tax agent"
  → build_agent intent (already existed; detects create/build … agent)
  → answerBuild surfaces the plan summary + asks the first missing requirement
  → generateProposals emits ONE non-executable `agent_creation_plan` proposal:
       planAgentCreation(request):
         1. buildAgentDraft   — classifyRequest → name/domain/buildTarget/risk;
                                 missing commands/dataSources/interfaces → clarifying Qs
         2. classifyRequest   — deterministic classification            [reused]
         3. reviewStrategy    — BUILD_NOW / DO_NOT_BUILD / … + reason    [reused]
         4. recommendSkills   — from the Factory skill catalog (advisory)
         5. requiredCapabilitiesFor(buildTarget)                         [reused]
         6. planScaffold      — plan-level "would create" outline (no writes)
         7. planProviders     — provider provisioning plan + blocking gates (dry-run)
       → approvalGates, risks, doNotBuild, readyToPlanScaffold, summary
  → proposal: executable:false, requiredApproval:"Hart", dryRunResult set,
              secret-scanned on queue write. Approval → simulated only;
              executeProposal() still throws (no execution path exists).
```

## Requirements gathering (multi-turn)
`buildAgentDraft(request, answers?)` accepts answers across turns. Until
`commands`, `dataSources`, and `interfaces` are supplied, the draft reports
`missingFields` and the router asks the corresponding clarifying question.
`readyToPlanScaffold` flips true only when the draft is complete. State is carried
in the proposal payload (queue-persisted, audited, secret-scanned).

## What 17A does NOT do (do-not-build, enforced)
- ❌ No real scaffold / fs writes — `planScaffold` enumerates only.
- ❌ No provider calls / provisioning — `planProviders` is a dry-run outline; the
  named gates (`ALLOW_AUTO_PROVISION`, `CONFIRM_*`, per-provider) stay closed.
- ❌ No execution path — `executeProposal()` remains hard-capped; `executable:false`.
- ❌ No GitHub repo creation, no secrets in generated plan content.
- ❌ No fork of the Factory `AgentConfig` / scaffold manifest into CC.

## Files
- `src/cockpit/agent-planner/agent-planner.ts` — the pure planner (draft, skills,
  scaffold outline, provider plan, full `planAgentCreation`).
- `src/cockpit/agent-planner/index.ts` — entry point.
- `proposals/proposal-types.ts` — new `agent_creation_plan` action type.
- `proposals/proposal-simulator.ts` — dry-run effect for `agent_creation_plan`.
- `proposals/proposal-generator.ts` — explicit "create X agent" → `agent_creation_plan`.
- `cockpit-intent-router.ts` — `answerBuild` surfaces the plan + clarifying question.
- `tests/cockpit-agent-planner.test.ts` — 13 tests (pure planner + proposal + router).

## Next (future, NOT in 17A)
- **17B** — backport the planner into the Agent Factory templates (CC→Factory).
- **17C+** — execution phase (real scaffold + provisioning) behind new gates, with
  the Factory producing the exact `AgentConfig` + manifest. Strictly gated.
