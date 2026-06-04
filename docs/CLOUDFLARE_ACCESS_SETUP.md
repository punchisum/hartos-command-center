# Cloudflare Access Setup (Phase 11J)

The hosted cockpit does **not** ship a custom auth system. Use **Cloudflare
Access** (Cloudflare Zero Trust) as the front door before any production
exposure. This is the recommended, supported path.

## Checklist (acknowledge before sharing a hosted URL)

1. Enable Cloudflare Zero Trust on the account.
2. Create an **Access application** for the cockpit hostname/route.
3. Add an **Access policy** allowing only your identity/email (or team).
4. Require an identity provider (Google, GitHub, one-time PIN, etc.).
5. Confirm the cockpit route returns the Access login challenge for
   unauthenticated requests.
6. Only then share the URL.

## Why

- The cockpit is read-only, but it surfaces operational state. Treat it as
  sensitive.
- Cloudflare Access enforces authentication at the edge, before the Worker runs.
- This avoids a homemade auth system (out of scope and risky to build ad hoc).

The deploy-plan report (`cockpit:cloudflare:deploy-plan`) repeats this checklist
and records that Cloudflare Access is required before production exposure.
