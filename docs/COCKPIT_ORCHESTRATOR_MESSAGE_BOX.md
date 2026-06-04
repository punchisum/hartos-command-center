# Cockpit Orchestrator Message Box (Phase 11H)

> The **Ask HartOS** box commands the HartOS Orchestrator. It is an operator
> command line, not casual chat. Recommendations only — the cockpit never
> executes a dangerous action.

## Flow

```text
Ask HartOS (textarea)
   → POST /api/orchestrator/message   (local server)
   → validateRequest()                (non-empty, ≤ max length, no secrets)
   → askOrchestrator()                (cockpit-orchestrator-bridge)
   → runOrchestrator()                (existing local Orchestrator, Phase 11F)
   → structured CockpitOrchestratorResponse
   → persist thread + message + report (cockpit-threads/, cockpit-reports/)
   → render response panel
```

The bridge calls Orchestrator source functions directly (no blind shelling out).

## Message contract

`CockpitMessageInput`:

```text
request    (string, validated)
source     = "cockpit"
createdAt  (ISO timestamp)
mode       = "local"
threadId   (optional — appends to an existing thread)
```

`CockpitOrchestratorResponse`:

```text
requestId
threadId
classification (classification/domain/riskLevel/buildTarget/recommendedSpecialist)
strategyReview (summary)
ctoReview (summary)
capabilityGaps (summary)
buildPlanSummary
handoverPath
reportPaths
nextRecommendedCommand
blockedActions          (forbidden — non-executable)
approvalRequiredActions (gated — non-executable)
```

## Local server routes

```text
GET  /                          → cockpit HTML
GET  /api/state                 → cockpit state JSON (22 cards)
GET  /api/reports               → local report list
GET  /api/threads               → persisted thread list
POST /api/orchestrator/message  → run local Orchestrator, return response
```

`POST /api/orchestrator/message` may only call local Orchestrator logic. No
provider mutation, no Supabase mutation, no pack mutation, no network calls.

## Validation

```text
request must be a non-empty string
request must be ≤ 4000 characters
secret-looking input is rejected with safe error JSON
invalid JSON body → 400
oversized body → 413
```
