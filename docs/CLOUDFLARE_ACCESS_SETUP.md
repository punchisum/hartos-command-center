# Cloudflare Access (Zero Trust) for the HartOS Cockpit

This is the runbook for putting **identity-based** protection (Google / email one-time-PIN)
in front of the cockpit, on top of the bearer token it already enforces.

> **Do this from a device you can re-authenticate on (i.e. when you're home), and verify login
> works BEFORE you rely on it.** A misconfigured Access policy can lock you out of your own
> cockpit. The steps below are ordered so you never remove the existing protection until the new
> one is proven.

## What's already in place (you are not exposed)

- `APP_ENV=production` **requires** the `HARTOS_COCKPIT_ACCESS_TOKEN` secret. With no token the
  Worker **fails closed**: every protected route returns `401` and the UI shows a LOCKED page.
- `/health` is intentionally public; `/` and `/api/*` require the token.
- So the cockpit today is a **shared-bearer-token** wall. Cloudflare Access upgrades that to
  **per-identity** auth (you log in as you, with Google or an email PIN — no shared secret to leak).

## Hard prerequisite: a custom domain

Cloudflare Access **cannot** be applied to a raw `*.workers.dev` URL
(`hartos-command-center.hartos.workers.dev`). Access protects hostnames on a **zone you own** in
Cloudflare. So step 1 is to give the Worker a custom domain.

### 1. Add a custom domain to the Worker

Pick a hostname on a domain already in your Cloudflare account, e.g. `cockpit.<yourdomain>`.

- Dashboard: Workers & Pages -> `hartos-command-center` -> Settings -> Domains & Routes ->
  **Add Custom Domain** -> `cockpit.<yourdomain>`.
- Or in `wrangler.cockpit.toml`:
  ```toml
  routes = [{ pattern = "cockpit.<yourdomain>", custom_domain = true }]
  ```
  then `npx wrangler deploy --config wrangler.cockpit.toml`.

Confirm `https://cockpit.<yourdomain>/health` returns `{"ok":true,...}` before continuing.

### 2. Create the Access application

Zero Trust dashboard -> **Access -> Applications -> Add an application -> Self-hosted**:

- Application name: `HartOS Cockpit`
- Session duration: e.g. 24h
- Application domain: `cockpit.<yourdomain>`

### 3. Add the policy (allow only you)

Add a policy on that application:

- Policy name: `Hart only`
- Action: **Allow**
- Include -> **Emails** -> `punchisum@gmail.com`
- Identity provider: Google, or the built-in **One-time PIN** (email) if you don't want to wire Google.

### 4. Verify BEFORE you depend on it

- Open `https://cockpit.<yourdomain>/` in a fresh/incognito window -> you should hit the Access login,
  authenticate as `punchisum@gmail.com`, and then land on the cockpit.
- If login fails, fix the policy **before** removing any other protection. You still have the
  workers.dev URL + bearer token as a fallback during cutover.

### 5. (Optional) keep the bearer token as a second factor / for the runner

- Leave `HARTOS_COCKPIT_ACCESS_TOKEN` in place so the API stays token-gated even behind Access
  (defense in depth), or
- Issue a **Cloudflare Access service token** for any non-browser caller and add a second
  (service-token) policy, so automated callers work without a human login.

## Rollback (no unprotected window)

- Remove the Access application (Zero Trust -> Access -> Applications -> delete), or
- Remove the custom domain route and keep using the `workers.dev` URL + bearer token.

Either way the cockpit stays protected by the existing token.

---

## Original Phase-11J checklist (kept for reference)

1. Enable Cloudflare Zero Trust on the account.
2. Create an **Access application** for the cockpit hostname/route.
3. Add an **Access policy** allowing only your identity/email (or team).
4. Require an identity provider (Google, GitHub, one-time PIN, etc.).
5. Confirm the cockpit route returns the Access login challenge for unauthenticated requests.
6. Only then share the URL.

The deploy-plan report (`cockpit:cloudflare:deploy-plan`) repeats this checklist and records that
Cloudflare Access is required before production exposure.
