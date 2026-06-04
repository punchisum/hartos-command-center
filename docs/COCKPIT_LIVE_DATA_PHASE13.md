# Cockpit Live Read-Only Data (Phase 13)

Phase 13 makes the Fitness/Ops/Factory panels **trustable**: every important
field carries a value, a source, a `lastUpdated`, a freshness verdict, and a
confidence — or, when unavailable, the exact next setup step. Nothing is
fabricated; stale data is visibly stale.

## Read-only source layer (`src/cockpit/sources/`)

A "source" is a read-only boundary. `SourceResult` (see `source-types.ts`) is
the shared envelope:

- `name`, `sourceType`, `status` (available/partial/unavailable)
- `lastUpdated`, `freshness` (fresh/stale/unknown), `confidence`
- `missingReason` + `setupStep` when unavailable
- `diagnostics` (names/paths/notes only — **never** secret values)
- `values`: per-field `SourceValue` with its own provenance + freshness

### Data priority (per field)

```
live read-model (Supabase, read-only) → local generated report → handover file → unavailable + setup step
```

`layered.ts` resolves each field by walking the layers in priority order; the
first layer with a value wins and carries its freshness/confidence.

### Freshness model (`freshness.ts`, Phase 13E)

`computeFreshness(lastUpdated, now)` → `fresh` (≤ 24h), `stale` (older), or
`unknown` (no timestamp). `confidenceFor(sourceType, freshness)` derives
confidence. `now` is always injected — deterministic + testable.

### Safety

- **No mutation methods** anywhere in the source layer.
- **No service-role keys.** `secret-guard.ts#isServiceRoleKey` decodes the JWT
  locally (never transmits/prints it); the read-model client factory refuses a
  service-role key and degrades to `missing`.
- Missing env/config degrades safely; the patch never blocks when Supabase is
  not configured.
- Report/handover parsers drop secret-looking values.

## Adapters

- **Fitness** (`fitness-source.ts`) — calories/protein (+ remaining), today's
  plan + completion, recovery, HRV/RHR/sleep freshness, weekly load, latest
  workout. Live → report → handover.
- **Ops** (`ops-source.ts`) — active/urgent/blocked cards, ClickUp sync, pending
  approvals, latest updates. Never queries ClickUp directly; reads only the
  governed read-only boundary. DD/recent reports come from the report listing.
- **Factory** (`factory-source.ts`) — latest verification, generated-agent
  verification, and build report artefacts (with freshness), plus capability
  registry + runtime modules from the panel.

Panel builders stay **pure**: when no resolved source is supplied they derive
one from the in-memory read-model summary (preserving Phase 12 behavior). The
async `gatherPanelInputs` does the file I/O and supplies the enriched sources.

## UI

Each field shows its freshness badge (`fresh`/`stale`/`unknown`), `lastUpdated`,
source, and confidence — concise, not noisy. Unavailable fields show
`unknown`/`not configured`/`no data found` + the exact setup step.
