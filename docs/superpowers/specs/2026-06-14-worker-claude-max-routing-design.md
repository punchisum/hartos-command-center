# DESIGN — Routing the cockpit Worker's "Ask" to Claude-on-Max

- **Date:** 2026-06-14
- **Status:** Design only (no implementation). Decision-ready.
- **Scope:** The hosted Cloudflare cockpit Worker's `POST /api/ask` path. Host-side intelligence (Ask CLI, daemon, scripts) already uses Claude-Max via `src/llm/host-gateway.ts`; **only the edge Worker is left.**

---

## 1. Problem & current state

The cockpit Worker is deployed on Cloudflare's edge and answers "Ask HartOS" today through a key-bearing LLM gateway that calls **Gemini** (then OpenAI, then deterministic). We want the Worker's Ask to reason with **Claude-on-Max** — the reliable Max-plan brain — which can only run on the **local Node daemon**, because it is a `claude -p` child-process spawn.

### What the edge can and can't do

- `src/llm/providers/claude-max-provider.ts` imports `node:child_process` and runs `spawn("claude", ["-p", "--output-format", "json", "--model", model])`. **Cloudflare Workers cannot spawn a process** — workerd has no `child_process`. So Claude-Max is structurally impossible on the edge.
- `src/llm/host-gateway.ts` is explicitly **HOST-ONLY** and documents that it must never enter the Worker bundle (it pulls the spawn provider). The Worker's gateway is wired *without* `extraProviders` — that is why the edge falls back to Gemini.

### The current Worker Ask path (the contract we must preserve)

In `src/runtime/cloudflare-cockpit-worker.ts`, `POST /api/ask`:

1. `validateRequest()` → `routeHosted()` builds the **deterministic grounding** (`summary/title/highlights/gaps`).
2. The grounding is enriched (fleet-synthesis, forecast, decisions, Rinnegan briefing).
3. `composeAskAnswer(grounding, request, context, { infer: ctx.askInfer })` is called.
   - `askInfer` is `buildAskInfer({ env })` from `src/llm/run-ask-llm.ts` → wraps the Gemini-armed `LlmGateway`.
   - **Doctrine invariant:** the LLM may *reason/propose*, never execute/approve (`proposeOnly: true`). The request is **redacted first** (`redact()` in `ask-llm.ts`), context is deep-redacted.
   - On any null / throw / malformed output, it **collapses to the deterministic grounding** with an honest `fallbackReason`.
4. Response JSON includes `mode`, `provider`, `usedLlm`, `gateReason`, `fallbackReason`, `title`, `summary`, `highlights`, `gaps`, `riskLevel`, plus routing/concierge/proposals blocks.

**Key seam:** `AskInfer = (redactedRequest, context?) => Promise<LlmResult | null>`. Everything below is *just a different implementation of this injected function* (or a wrapper around the route). The orchestrator's redact-first + honest-fallback contract does not change.

### Async precedent already in the codebase (this matters)

The Worker → Supabase → daemon round-trip **already exists**, three times over:

- **Worker → Supabase (write, no DB key):** `persistCockpitProposals()` (`cloudflare-live-read-models.ts`) POSTs to the gated Edge Function `persist-cockpit-proposal` (`HARTOS_ASK_WRITE_URL`) using a **shared capability token** (`HARTOS_ASK_WRITE_TOKEN`). The Worker holds no service-role key; the Edge Function self-authenticates with the service role server-side. Secret-scans every row.
- **Daemon polls Supabase:** `scripts/run-live-runner.ts` + `src/jobs/live-runner.ts` reconcile-poll the approved-job queue every `HARTOS_RUNNER_POLL_SEC` (default **5s**) and execute newly-approved jobs. It also runs sub-cadence passes (fitness poll, self-mod, council).
- **Daemon → Supabase liveness:** `writeDaemonHeartbeat()` upserts `daemon_heartbeats` every 5 min; the Worker cron reads it as a dead-man's-switch.

So "Worker writes a row, daemon picks it up within ~5s, writes a result back, Worker reads it" is **not new infrastructure** — it is the established pattern. This heavily favors Option B.

### Cloudflare surfaces available

- `wrangler.cockpit.toml`: only `[triggers] crons`, `[vars]`, and `wrangler secret put` secrets. **No Durable Objects, no Queues, no KV** bindings configured today. `nodejs_compat` is on.
- No `cloudflared` / Cloudflare Tunnel is in use anywhere in the repo (grep confirms the only "cloudflared"-ish hits are coincidental substrings of "cloudflare" + "deployment").
- Edge Functions in use: `persist-cockpit-proposal` (write + transition + refresh-sync), self-authenticating via `HARTOS_ASK_WRITE_TOKEN`.

---

## 2. Architecture options

### Option A — Cloudflare Tunnel (synchronous)

**How it works (sequence):**

1. The daemon runs a tiny local HTTP server exposing `POST /infer` that calls `buildHostGateway(process.env)` (the existing claude-max wiring) and returns an `LlmResult`. It authenticates each request with a shared secret (`Authorization: Bearer <TUNNEL_INFER_SECRET>`), ideally hardened with Cloudflare Access (mTLS / service token).
2. `cloudflared tunnel` runs on Hart's machine and publishes that server at a stable hostname (e.g. `claude-infer.hartos.app`), with **no inbound port opened** on the home network.
3. The Worker's `askInfer` becomes an HTTP client: it POSTs the redacted request + context to the tunnel URL with the secret, awaits Claude-Max, returns the `LlmResult`. On timeout/non-200/null → return null → orchestrator falls back to Gemini.

- **Latency:** Real-time. One synchronous round-trip; user sees a normal spinner. Claude-Max itself is the dominant cost (single `claude -p` call, often 3–15s; the provider timeout is 120s but Ask should cap far lower, ~20–30s, then fall back).
- **Security surface:** **Exposes the daemon to the internet** (the whole point of a tunnel). Mitigations required: shared bearer secret *and* Cloudflare Access in front (service token or mTLS) so the endpoint is not callable by anyone who learns the URL. The inference endpoint must be **reason-only** — it must never accept or execute an action, and should reuse the same redaction posture. This is the larger attack surface of the three options.
- **Infra needed:** install + run `cloudflared` 24/7 on Hart's machine (another always-on process beside the daemon); a Cloudflare Tunnel + DNS record; a Cloudflare Access policy; a new secret in both the daemon env and the Worker secrets. A small new local HTTP listener in the daemon.
- **Reliability / failure modes:** daemon down, tunnel down, or `cloudflared` crashed → Worker times out → falls back to Gemini (Ask never hard-fails). Home network / ISP outage takes the brain offline. More moving parts that can independently fail than Option B. No queueing — a burst of Asks hits the daemon concurrently (the provider has a concurrency semaphore, default 3).
- **Effort:** Medium-high. New local server, tunnel + Access config, secret management, a synchronous `askInfer` HTTP client, plus the operational burden of keeping `cloudflared` alive.

### Option B — Async relay via Supabase (request/response queue) — **RECOMMENDED**

**How it works (sequence):**

1. Worker `POST /api/ask` builds the deterministic grounding + redacted request **as today**. Instead of (or before falling back to) calling Gemini, it writes an `ask_request` row via a **new gated Edge Function** (`relay-ask`, same self-auth pattern as `persist-cockpit-proposal`, reusing `HARTOS_ASK_WRITE_TOKEN` or a sibling token). Row carries the redacted request + redacted grounding context + a fresh `id`.
2. The Worker then **short-polls for the answer**: it reads the row's `answer`/`status` via the read-only RPC (same read posture as the cockpit's other Supabase reads), every ~600ms, up to a budget of ~8–12s (Worker `fetch` subrequest limits are generous; we cap well under them).
3. The **daemon** (already polling at 5s) gains one more sub-pass: pull `ask_request` rows where `status='pending'`, run `buildHostGateway()` → Claude-Max, validate, and write `answer` + `status='answered'` back. (Tighten this poll to ~1–2s on a dedicated cadence so the user-facing latency is acceptable — the 5s job cadence is too slow for an interactive Ask.)
4. The Worker's poll sees `status='answered'`, returns the Claude-Max answer through the unchanged `composeAskAnswer` response shape (`usedLlm:true`, `provider:"claude-max"`).
5. **Timeout → fall back to Gemini.** If the poll budget expires (daemon offline/slow), the Worker calls its existing `buildAskInfer({env})` (Gemini) and returns *that* answer, marking `fallbackReason` honestly. The stale `ask_request` row is left for the daemon to answer-and-discard or expire (mirrors the proposal `refresh_sync` expiry hygiene).

**Table schema (`ask_requests`, fitness/cockpit Supabase project):**

| column | type | notes |
|---|---|---|
| `id` | uuid / text PK | content-or-random id from the Worker |
| `status` | text | `pending` → `answered` → (`expired`) |
| `redacted_request` | text | already redacted by the Worker (§16) |
| `context` | jsonb | deep-redacted grounding context |
| `answer` | jsonb | the validated `LlmResult` (8-field) the daemon writes |
| `provider` | text | `claude-max` when answered by the daemon |
| `error` | text | nullable; daemon-side failure reason |
| `created_at` | timestamptz | default now() |
| `answered_at` | timestamptz | nullable |
| `expires_at` | timestamptz | TTL (e.g. now()+2 min); a hygiene pass expires stragglers |

RLS: the Worker writes via the service-role Edge Function (no DB key on the edge, identical to `persist-cockpit-proposal`); reads via the existing read-only anon key + a security-definer RPC scoped to a single id. Secret-scan the request and the answer on both write paths.

- **Latency:** Polling-bound. With a ~1–2s daemon sub-cadence + ~600ms Worker poll, expect **~2–4s added** over the raw Claude-Max call vs. Option A's near-zero overhead. Total user-visible time ≈ daemon poll lag + Claude-Max (~3–15s) + Worker poll lag. Acceptable for a deliberate "Ask" with a spinner; not for keystroke-latency UX.
- **Security surface:** **The daemon is never exposed.** No inbound anything; the daemon only makes *outbound* calls to Supabase (exactly as it does today for jobs + heartbeat). The only new internet-facing surface is one more gated Edge Function behind a capability token — a surface we already operate and trust. **Strongest security posture of the three.**
- **Infra needed:** one new table + one security-definer read RPC + one Edge Function (clone of the existing one) + one new daemon sub-pass. All reuse patterns that already exist. No new always-on process, no tunnel, no DNS, no Access policy.
- **Reliability / failure modes:** daemon offline/slow → Worker poll times out → **clean fall back to Gemini** (the existing path). DB blip on write → fall back to Gemini immediately. A "lost" request just expires via the hygiene pass. Failure modes are fewer and already-instrumented (the dead-man's-switch already alerts Hart when the daemon goes silent).
- **Effort:** Medium. Mostly *assembling existing pieces*: a new table, a near-clone Edge Function, a daemon sub-pass, and a polling `askInfer`. No new ops surface to babysit.

### Option C — Durable Object / Cloudflare Queue (hybrid)

A Durable Object could hold the in-flight Ask and let the daemon connect *outbound* via WebSocket to the DO (daemon dials out, so still no inbound exposure), giving push-style delivery instead of polling — lower latency than B without exposing the daemon like A. A Cloudflare Queue could buffer Ask requests for the daemon to consume.

- **Latency:** Best-of-both for a push DO (no poll interval); Queues add their own delivery lag and are built for throughput, not request/response.
- **Security:** DO-with-outbound-WebSocket keeps the no-inbound property of B. Good.
- **Infra needed:** **net-new Cloudflare primitives** — DO namespace + migration in `wrangler.cockpit.toml` (none today), a WebSocket client in the daemon, state management in the DO. The daemon would hold a persistent outbound socket to the edge (a new long-lived connection to operate).
- **Reliability/effort:** **High effort, new failure surface** (WebSocket reconnection, DO lifecycle, hibernation) for a latency win that B's tuned poll cadence largely closes. Not justified for a single-user, low-QPS cockpit.

**Verdict on C:** Over-engineered for the volume. Revisit only if Ask becomes high-frequency/multi-user and polling latency becomes the bottleneck.

---

## 3. Recommendation

**Adopt Option B (async relay via Supabase).**

> One-line rationale: it routes Ask to Claude-Max **without ever exposing the daemon to the internet** and is built almost entirely from infrastructure HartOS already runs (gated Edge Function + capability token + daemon poll + dead-man's-switch), so it is the lowest-risk, lowest-ops path — and the polling latency is acceptable for a deliberate "Ask."

We favor security + reuse over the real-time edge of Option A. Option A's only advantage (near-zero overhead) does not outweigh standing up `cloudflared` 24/7, a tunnel + Access policy, and an internet-reachable inference endpoint on Hart's machine. Option C's latency win doesn't justify net-new Cloudflare primitives for a single-user cockpit.

### Hard fallback rule (non-negotiable)

**Ask must never hard-fail.** Whenever the Claude-Max path is unavailable — daemon offline, poll budget exceeded, relay write fails, malformed answer — the Worker falls back to its **existing Gemini `askInfer`** (`buildAskInfer({env})`) and ultimately to the deterministic grounding, exactly as `composeAskAnswer` already does. The response must label the path honestly (`provider`, `usedLlm`, `fallbackReason`) so "Claude-Max wasn't used" is never silent. This preserves today's behavior on the unhappy path bit-for-bit.

### Phased build plan

1. **P-B0 — Schema + RPC (Hart gate to apply):** add `ask_requests` table + a security-definer read-by-id RPC + a TTL/expiry hygiene query, in the cockpit/fitness Supabase project. Migration is a *designed* file; applying it is Hart's gate (per the migration-apply mechanism). Disarmed: nothing reads/writes it yet.
2. **P-B1 — Relay Edge Function:** clone `persist-cockpit-proposal` into `relay-ask` (self-auth via capability token, secret-scan request + answer). Deploy disarmed (Worker doesn't call it yet).
3. **P-B2 — Daemon sub-pass (gated no-op by default):** add an `ask-relay` pass to `run-live-runner.ts` that, **only when `HARTOS_ASK_RELAY=on`**, pulls `pending` rows, runs `buildHostGateway()`, validates, writes the answer. Tighten its cadence (~1–2s) independent of the 5s job poll. Default = pure no-op (mirrors the fitness-poll gating).
4. **P-B3 — Worker relay `askInfer` (flag-gated):** behind a Worker flag (e.g. `HARTOS_ASK_VIA_RELAY=true`), swap `ctx.askInfer` to the relay client (write row → short-poll → return `LlmResult` or null). Null → orchestrator's existing Gemini/deterministic fallback. Flag off → identical to today.
5. **P-B4 — Arm + observe:** turn on both flags, watch latency + fallback rate via the existing honest diagnostics (`usedLlm`, `fallbackReason`, `provider`). Tune poll cadences. Add an alert if the relay fallback rate spikes (reuse the alert bus).

Each phase ships **loop-ready and disarmed** until the prior one is proven — consistent with how P5/P6 landed.

---

## 4. Decision needed from Hart

1. **Acceptable Ask latency.** Option B adds ~2–4s of poll overhead on top of Claude-Max's own ~3–15s. Is "a few seconds, with a spinner" fine for Ask? If you need *near-instant* and will run `cloudflared`, that tips toward Option A.
2. **Willingness to run `cloudflared` 24/7** on your machine and stand up a Cloudflare Tunnel + Access policy + internet-reachable inference endpoint. If **no** → Option B is the answer by default.
3. **Secret management.** Reuse the existing `HARTOS_ASK_WRITE_TOKEN` capability token for the relay Edge Function, or mint a dedicated `HARTOS_ASK_RELAY_TOKEN`? (Recommend a dedicated token so the Ask-relay surface can be rotated/revoked independently of proposal writes.)
4. **Daemon poll cadence for Ask.** OK to add a faster (~1–2s) sub-pass to the live-runner for interactive Asks, separate from the 5s job-reconcile cadence? (Slightly more DB read volume; still low.)
5. **Fallback transparency.** Confirm that on a Claude-Max miss we **silently** fall back to Gemini (answer still appears, only the `provider`/`fallbackReason` fields reveal it), vs. surfacing a visible "answered by backup brain" note in the cockpit UI.
6. **Where the table lives.** Confirm the `ask_requests` table belongs in the cockpit-proposal Supabase project (`xbuinrnpfjltimofwrdx`) alongside `cockpit_proposals` — not the GECAN OPS project — per the two-DB split.
