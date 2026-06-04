# HartOS Strategy Review (Prophet)

**Phase 11F** — strategy review module

## Role

The Prophet protects Hart from building beautiful, useless infrastructure.
It is a strategy-review module **inside** the Orchestrator.

It answers:

- Should Hart build this?
- Should Hart delay this?
- Is this infrastructure cosplay?
- Is there a simpler path?
- What is the opportunity cost?
- What proof is needed before building?

## Command

```bash
npm run hartos:strategy-review -- --request="I want to build a command center"
```

## Verdicts

```
BUILD_NOW
BUILD_LATER
DO_NOT_BUILD
DEVOUR_EXISTING_CAPABILITY
MERGE_WITH_EXISTING_AGENT
NEEDS_MORE_EVIDENCE
```

## Scoring dimensions (0–10)

```
real_friction_removed
decision_quality_improved
repeated_workflow_automated
blind_spot_exposed
revenue_or_time_impact
urgency
complexity
maintenance_burden
dependency_risk
opportunity_cost
```

Leverage score = sum of the first five (value signals).
Cost score = complexity + maintenance + dependency + opportunity cost.

## Key rules

- **Foundation-first for tax**: a tax build with missing receipt/document
  capabilities is downgraded to `BUILD_LATER` with a foundation-first sequence.
- **Cosplay guard**: a dashboard / cockpit / command center with no approval,
  manual_required, or reporting anchor is flagged as infrastructure cosplay and
  downgraded.
- **Repeated workflow automation** scores high on `repeated_workflow_automated`
  and leans toward `BUILD_NOW`.

## Output shape

```json
{
  "verdict": "BUILD_LATER",
  "reason": "...",
  "expectedLeverage": "high",
  "risk": "high",
  "maintenanceBurden": "medium",
  "simplerAlternative": "...",
  "requiredProof": ["..."],
  "recommendedNextAction": "...",
  "scores": { "...": 0 }
}
```

Tone in generated reports is professional.

---

Phase 11F — HartOS Agent Factory v2
