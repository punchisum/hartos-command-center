# Cloudflare Hosted Cockpit — Security (Phase 11J)

The hosted cockpit is treated as **future public-facing** even if initially
private. The security policy lives in `src/runtime/cloudflare-security.ts`.

## Boundaries

- **All provider keys stay server-side.** Env values are never sent to the
  browser. Status endpoints report PRESENCE only (booleans), never values.
- **No secrets are exposed to frontend.** Served HTML and client JS contain no
  secrets; there is no raw env dump.
- **No action execution.** Action buttons render disabled; the hosted cockpit
  cannot execute, deploy, promote, or mutate anything.
- **No mutation endpoints.** Only read-only `GET` state/report/thread routes and
  a single validated, read-only `POST /api/orchestrator/message` exist.
- **Method allowlist** — only `GET`, `POST`, `OPTIONS`. Everything else → 405.
- **Body size limit** — oversized bodies → 413; invalid/secret-looking input →
  400 safe error JSON (no stack traces, no env dump).
- **CORS is default-denied** unless `CLOUDFLARE_COCKPIT_ALLOWED_ORIGIN` is set
  and the request Origin matches exactly.
- **Conservative response headers** — `nosniff`, `DENY` framing, `no-store`.

## Recommended front door

This phase does **not** add a homemade auth system. Put the hosted cockpit
behind **Cloudflare Access** (Zero Trust) before any production exposure — see
[CLOUDFLARE_ACCESS_SETUP.md](CLOUDFLARE_ACCESS_SETUP.md). The deploy plan report
includes a Cloudflare Access checklist.

## Not in this phase (by design)

No Supabase mutation, no provider mutation, no ClickUp/Google Drive/Apple
Health/Telegram calls, no live action execution.
