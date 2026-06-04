# Cockpit Real Read-Only Data Activation (Phase 13.5)

Phase 13.5 makes the panels light up with real read-only data where available
and explains, precisely, why a field is missing when it is not.

## Read-model diagnostics (`src/cockpit/sources/source-diagnostics.ts`)

`buildSourceDiagnostics({ cwd, now, sources, env })` reports, per domain
(fitness/ops/factory):

- `configured` / `enabled` and a `status`: `live` · `stale` · `disabled` ·
  `missing_env` · `not_configured` · `rejected_unsafe` · `reports_only` ·
  `unavailable`
- `freshness`, `resolvedFields`, `missingEnv`, `rejectedUnsafe`, `setupStep`, `note`

It also rolls up `configuredSources`, `enabledSources`, `disabledSources`,
`missingSources`, `staleSources`, and `rejectedSources`.

**Safety**: it inspects key *presence* and a locally-decoded JWT role claim
only — it never prints or stores a secret. A Supabase **service_role** key is
flagged `rejected_unsafe` and the domain degrades with a setup step to use a
read-only anon key.

The diagnostics are attached to `CockpitState.sourceDiagnostics` and rendered in
a **Read-model Diagnostics** section.

## Activation (13.5B/C/D)

The fitness/ops/factory panels consume the resolved `SourceResult` (Phase 13),
which already walks the priority chain **live read-model → local report →
handover → unavailable + setup step**. Phase 13.5 adds:

- Distinct **disabled** vs **missing_env** vs **not_configured** vs **stale**
  states in the diagnostics + panel summaries.
- Factory: latest validation/test counts (parsed from the latest verification/
  smoke report), latest cockpit report, plus the existing verification/build
  artefacts — all with freshness.

Graceful degradation is preserved: tests never require live Supabase; stale data
shows as `stale` (not missing); partial data shows partial + explicit gaps;
values are never invented.

## Data diagnostics command (13.5E)

A new `read_model_status` router intent answers:

- "Show read model status" · "What sources are connected?" · "What data is stale?"
- "Why is my fitness panel missing data?" · "Why is my ops panel missing data?"

The grounded answer lists source status by domain, enabled/disabled/missing/stale
state, any rejected unsafe keys, and the exact setup steps — with no secrets.
