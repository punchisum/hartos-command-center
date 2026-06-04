/**
 * scripts/cockpit-cloudflare-smoke.ts
 *
 * smoke:hosted / smoke:cloudflare — exercise the hosted cockpit Worker handler
 * with MOCKED requests, including the auth gate. No server, no network, no
 * deploy, no mutation. Proves: read-only routes respond, /api/ask is grounded,
 * status/brief questions create zero proposals, action execution stays disabled,
 * auth fails closed without a token and succeeds with the bearer token, and no
 * secret value leaks into any response.
 *
 * Usage: npm run smoke:hosted
 */

import { handleCockpitRequest, createCockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-worker.js";

const base = "https://cockpit.local";
const cwd = process.cwd();
const ctx = await createCockpitWorkerContext({ cwd });

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) {
    console.log(`  ok   ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("\nHartOS Hosted Cockpit — Smoke (mocked, no network, no deploy)\n");

// ── Open mode (no token configured) — local default ──
console.log("Open mode (no access token configured):");
{
  const health = await handleCockpitRequest(new Request(`${base}/health`), {}, ctx);
  const healthData = (await health.json()) as { ok: boolean; actionExecution: string };
  check("GET /health → 200 ok", health.status === 200 && healthData.ok === true);
  check("/health action execution disabled", healthData.actionExecution === "disabled");

  const home = await handleCockpitRequest(new Request(`${base}/`), {}, ctx);
  const homeBody = await home.text();
  check("GET / → 200 HTML", home.status === 200 && homeBody.includes("<!doctype html>"));
  check("home page has no enabled action button", !/<button(?![^>]*disabled)[^>]*>(?:(?!<\/button>).)*?(execute|deploy|run)/i.test(homeBody));

  for (const route of ["/api/state", "/api/freshness", "/api/read-models/status", "/api/proposals"]) {
    const res = await handleCockpitRequest(new Request(`${base}${route}`), {}, ctx);
    check(`GET ${route} → 200`, res.status === 200);
  }

  // /api/ask — Daily Command Brief, zero proposals
  const brief = await handleCockpitRequest(
    new Request(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "What needs my attention today?" }) }),
    {},
    ctx
  );
  const briefData = (await brief.json()) as { intent: string; summary: string; proposalCount: number; actionExecution: string };
  check("POST /api/ask brief → daily_brief intent", brief.status === 200 && briefData.intent === "daily_brief");
  check("brief summary starts with 'Command Brief:'", /^Command Brief:/m.test(briefData.summary));
  check("brief creates zero proposals", briefData.proposalCount === 0);
  check("brief action execution disabled", briefData.actionExecution === "disabled");

  // status questions → zero proposals
  for (const q of ["Is my data fresh?", "Anything urgent in ops?", "Why is ops stale?"]) {
    const res = await handleCockpitRequest(
      new Request(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: q }) }),
      {},
      ctx
    );
    const data = (await res.json()) as { proposalCount: number };
    check(`"${q}" creates zero proposals`, data.proposalCount === 0);
  }
}

// ── Fail-closed auth (token configured) ──
console.log("\nAuth gate (HARTOS_COCKPIT_ACCESS_TOKEN configured):");
{
  const token = "smoke-secret-token-value";
  const env = { HARTOS_COCKPIT_ACCESS_TOKEN: token };

  const noAuth = await handleCockpitRequest(new Request(`${base}/api/state`), env, ctx);
  check("GET /api/state without token → 401", noAuth.status === 401);

  const home = await handleCockpitRequest(new Request(`${base}/`), env, ctx);
  const homeBody = await home.text();
  check("GET / without token → login screen (200, no secret)", home.status === 200 && /sign in/i.test(homeBody) && !homeBody.includes(token));

  const withBearer = await handleCockpitRequest(new Request(`${base}/api/state`, { headers: { authorization: `Bearer ${token}` } }), env, ctx);
  check("GET /api/state with bearer → 200", withBearer.status === 200);
  const stateText = await withBearer.text();
  check("/api/state never contains the token value", !stateText.includes(token));

  const health = await handleCockpitRequest(new Request(`${base}/health`), env, ctx);
  check("GET /health stays public even with token configured", health.status === 200);

  const login = await handleCockpitRequest(
    new Request(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }),
    env,
    ctx
  );
  const setCookie = login.headers.get("set-cookie") ?? "";
  check("POST /api/login (correct token) → 200 + HttpOnly cookie", login.status === 200 && /HttpOnly/i.test(setCookie) && /SameSite=Strict/i.test(setCookie));

  const badLogin = await handleCockpitRequest(
    new Request(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: "wrong" }) }),
    env,
    ctx
  );
  check("POST /api/login (wrong token) → 401", badLogin.status === 401);
}

// ── Production with NO token → fail closed ──
console.log("\nProduction misconfiguration (APP_ENV=production, no token):");
{
  const env = { APP_ENV: "production" };
  const api = await handleCockpitRequest(new Request(`${base}/api/state`), env, ctx);
  check("GET /api/state in prod without token → 401 (fail closed)", api.status === 401);
  const home = await handleCockpitRequest(new Request(`${base}/`), env, ctx);
  const body = await home.text();
  check("GET / in prod without token → LOCKED page", home.status === 200 && /locked/i.test(body));
}

console.log("");
if (failures > 0) {
  console.log(`Hosted smoke FAILED: ${failures} check(s) failed.\n`);
  process.exit(1);
}
console.log("Hosted smoke passed — all read-only, auth fails closed, no secrets leaked, no execution.\n");
