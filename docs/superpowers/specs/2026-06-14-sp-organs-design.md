# SP-Organs — Registry-Backed, Supervised, Evidence-Promoted Organs

**Status:** Approved 2026-06-14. **Doctrine:** `UI = Reflect(SOT)`. *No frontend claim without backend proof.*

## Problem

The cockpit renders a hardcoded 18-node `CATALOG` (`meta-agent-registry.ts`) + `SEED_AGENT_MANIFESTS`
with **hand-typed "live" badges**, while the `agent_registry` table is empty (0 rows) and the `agents`
table holds 1 row. The named "organs" (Wolverine, Beezulbub, Research, Factory, Council) are
script-only demos invoked only when a human runs `scripts/*`; Prophet/Rinnegan/Sentinel run read-only
in the worker. Status is *asserted*, never *measured*. By the doctrine, almost nothing is observable.

## Goal

Turn the catalog into **supervised HartOS organs**: each has a registry row with a runtime contract,
a heartbeat, real runs that produce output rows, and a cockpit detail page that reads those outputs
back from the source of truth. Status is **derived from evidence**, never hardcoded. Organs are
promoted `REGISTERED → PARTIAL → LIVE` only as evidence accrues. The end state is truthful: the
cockpit reflects exactly how live each organ actually is.

## Approved constraints (verbatim)

1. Lock the schema + status deriver first, then parallelize the organ fan-out.
2. Do not force any organ to LIVE. **LIVE requires all four:** fresh heartbeat · real
   scheduled/on-demand run · output row / `output_ref` · cockpit readback from SOT.
3. Immediate cleanup folded into foundation: kill/terminally mark the runaway `wolverine.audit`
   loop; stop re-logging the same skipped proposal; skipped/refused jobs must not be infinitely
   re-runnable. **(DONE — commit `0e14660`.)**
4. Build all 11 organs in parallel after the contract lands: Wolverine, Beezulbub, Prophet, Rinnegan,
   Research Agent, Agent Factory, Council, Sentinel, Fitness, Ops projection, Cockpit.
5. Cockpit renders from registry + evidence, not CATALOG/SEED/hardcoded live badges.
6. End-of-build report shows each organ as REGISTERED/PARTIAL/LIVE/FAILED with evidence: registry row,
   `last_run_at`, heartbeat source, `last_output_ref`, cockpit route/readback, known blockers.
7. Do NOT advance Phase 2 or P8 in this build. After organ supervision: Phase 2
   (`cockpit_decision_outcomes` / outcome loop), then P8 (reflexive calibration).
8. **No external execution** unless separately approved. This build = registry, supervision,
   heartbeat, outputs, truthful cockpit reflection only.

## Architecture

### 1. Runtime contract (data model)

Extend the existing `agent_registry` table (don't greenfield) with the contract fields, and add a
companion `organ_runs` table as the evidence/output ledger. The `AgentManifest` contract in
`src/agents/agent-manifest.ts` is extended to match.

**`agent_registry` (static, written once at registration — REGISTERED state, no LIVE claim):**
- `agent_id` (pk, text) · `display_name` · `runtime_kind` ∈
  {`worker`, `daemon`, `daemon-supervised`, `external-webhook`, `projection`}
- `authority_tier` (reuse `tier`, T0–T4) · `heartbeat_source` (text pointer: table / daemon_id / RPC
  / worker-route that proves liveness) · `arming_flag` (env flag gating its run)
- `can_execute` (bool) · `can_write_external` (bool) · `required_approval_gate` (text)
- `detail_page` (cockpit route) · `known_risks` (jsonb) · `parent_id`

**`agent_registry` (derived/updated by the supervisor & deriver):**
- `last_run_at` · `last_output_ref` (fk into `organ_runs`) · `status` (cached derived value) ·
  `failure_state` (text/jsonb, last error)

**`organ_runs` (new table — append-only evidence ledger; the output rows):**
- `id` (pk) · `organ_id` (fk) · `run_at` · `trigger` (`scheduled`|`on_demand`|`worker`) ·
  `ok` (bool) · `disarmed` (bool) · `output_ref` (text — path/row id/vault note) ·
  `summary` (text) · `detail` (jsonb) · `duration_ms`

### 2. Status deriver (pure function — `deriveOrganStatus`)

Computed on every read from contract + evidence; **never stored as ground truth**, only cached.
- `REGISTERED` — row exists; no successful run evidence yet.
- `PARTIAL` — wired and either heartbeating OR has a run path, but missing ≥1 of {recent successful
  run, output row, cockpit readback}. Disarmed-by-policy organs rest here honestly.
- `LIVE` — **all four (constraint #2)**: heartbeat fresh (< organ's staleness threshold) **and** a
  real run (`organ_runs` row with `trigger ∈ {scheduled,on_demand,worker}`, `disarmed=false`)
  **and** an output (`ok=true` with `output_ref`) **and** the cockpit detail route can read that
  output back from SOT.
- `FAILED` — last run `ok=false`, or heartbeat stale past threshold.
- `RETIRED` — `retired_at` set.

Unit-tested as a pure function over fixture evidence (no DB).

### 3. Supervisor substrate (the daemon's new responsibility)

`runOrgan(organ, trigger)` wrapper in the live-runner:
1. Resolve the organ's `arming_flag`. If disarmed → write an honest heartbeat + an `organ_runs` row
   with `disarmed=true, ok=false` (keeps it PARTIAL/REGISTERED; **never fakes a run**, never
   re-enqueues — preserves the constraint #3 invariant).
2. If armed → invoke the organ's adapter entrypoint, capture `ok`/`output_ref`/`summary`, write the
   `organ_runs` row, update `agent_registry.last_run_at`/`last_output_ref`/`failure_state`.
3. A cadence map drives scheduled organs from the live-runner loop; on-demand runs reuse the existing
   `agent_job` path (now terminal-safe per `0e14660`). The job-runner's structurally-refused kinds
   stay terminal — organs that need real runs are driven by the supervisor, not the job-runner.

### 4. Per-organ adapters (parallel fan-out)

Each organ implements the same `OrganAdapter` interface (`run(trigger) → {ok, output_ref, summary}`),
mapping to its real entrypoint. First-pass contract (refined per-organ during build):

| Organ | runtime_kind | entrypoint | heartbeat_source | arming gate | can_exec / ext | expected end status |
|---|---|---|---|---|---|---|
| Cockpit | worker | worker `scheduled()` + `/health` | worker `/health` + cron logs | — (always on) | no / no | **LIVE** |
| Fitness | external-webhook + projection | `coach()` read + fitness poll | `agent_actions`/`agent_state_latest` recency | — | propose / no | **LIVE** |
| Ops projection | projection | GECAN read (`HARTOS_OPS_SUPABASE_URL`) | GECAN `sync_runs` recency (cross-project) | — | no / no | LIVE or PARTIAL (cross-project readback) |
| Sentinel | worker-cron + daemon | `assessFleetLiveness`/`runSentinelHeartbeat` | worker cron + `daemon_heartbeats` | armed | no / no | **LIVE** (needs an output row written per run) |
| Prophet | daemon-supervised | `forecast()` | `organ_runs(prophet)` (supervised pulse) | pulse arming | no / no | LIVE if supervised pulse writes output + readback |
| Rinnegan | daemon-supervised | `compileContext()` / context-pack sync | `organ_runs(rinnegan)` | gate | no / no | PARTIAL→LIVE (supervised sync writes a pack output) |
| Wolverine | daemon-supervised | `wolverineAudit()` | `organ_runs(wolverine)` | arming | no / no | LIVE (supervisor runs audit → findings output → readback) |
| Beezulbub | daemon-supervised / on-demand | `scout()`/`runBeezulbubHunt` | `organ_runs(beezulbub)` | `BEEZULBUB_ALLOW_NETWORK` | no / ext-read | PARTIAL→LIVE on a run |
| Research | daemon-supervised / on-demand | `runResearch()` | `organ_runs(research)` | `HARTOS_RESEARCH_GATHER`/LLM | no / web-read | **PARTIAL — blocked** (OpenAI out of credit; Gemini fallback) |
| Agent Factory | worker(interrogate) + daemon(build) | `interrogateSpec` / build | `organ_runs(factory)` | `ALLOW_CODE_BUILD` | yes / yes | **PARTIAL** (interrogate live; build = external, gated per #8) |
| Council | daemon-supervised | `runCouncil()` | `organ_runs(council)` | `HARTOS_ALLOW_COUNCIL` + goal | no / no | PARTIAL (disarmed; needs goal source) → LIVE when armed+goal |

### 5. Cockpit (reflect SOT)

- `/api/agents`, `/api/agent-registry`, the v5 connectome, and the org/fleet panels read the
  `agent_registry` table via `hartos_list_agent_registry()` + `deriveOrganStatus`. **Delete** the
  hardcoded `CATALOG`/`SEED_AGENT_MANIFESTS` consumption and every hand-typed "live" badge.
- Per-organ detail page (`detail_page`) renders the contract + derived status + `last_run_at` +
  heartbeat freshness + last `organ_runs` output (the **readback**) + known blockers.
- Empty/absent evidence renders honestly (REGISTERED / "no runs yet"), never a fake LIVE.

## Foundation already landed (constraint #3)

Commit `0e14660`: `prop-system-agent_job-run-wolverine-audit` terminalized (`status=failed`); 17,128
junk "skipped" rows purged (audit table 17,151 → 23); `hartos-runner.ts` `jobDisposition()` routes
structurally-refused/unknown kinds to terminal `failed` (out of the re-runnable set); transient
armable skips still re-runnable. Daemon restarted (PID 18892). Full suite 3287/3287.

## Testing

- `deriveOrganStatus` — pure unit tests over fixture evidence covering each ladder transition,
  including the four-part LIVE gate (drop any one piece → not LIVE).
- `runOrgan` disarmed path — writes honest skip beat, no fake run, no re-enqueue.
- Migration applies cleanly; `organ_runs` insert-only.
- Cockpit endpoints read registry not CATALOG (assert no CATALOG import in the read path).
- Per-organ adapter: smoke that `run()` returns a well-formed result and writes an `organ_runs` row.

## Out of scope (next builds)

Phase 2 (`cockpit_decision_outcomes` / outcome loop), then P8 (reflexive calibration). No external
execution (#8). No new autonomy beyond running read/propose-shaped organs under their existing gates.

## End-of-build deliverable (constraint #6)

A report table: organ · status (REGISTERED/PARTIAL/LIVE/FAILED) · registry row ✓ · `last_run_at` ·
heartbeat_source · `last_output_ref` · cockpit route/readback ✓ · known blockers — every cell backed
by a live SOT query, not prose.

## Parallelization

Foundation (migration + contract + `deriveOrganStatus` + `runOrgan` substrate + cockpit read-path
swap) lands first as one sequential unit. Then the 11 organ adapters + detail pages fan out in
parallel (each independent: its own adapter file, registry seed row, heartbeat mapping, detail
render). Integrate, run the full suite, produce the evidence report.
