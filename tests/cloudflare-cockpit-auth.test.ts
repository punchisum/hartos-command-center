/**
 * tests/cloudflare-cockpit-auth.test.ts — Phase 16.
 * The hosted cockpit auth gate fails closed: unauthenticated API requests are
 * 401, production with no token fails closed, /health stays public, bearer +
 * cookie auth work, the dev bypass is honored only outside production, and the
 * token value never leaks into any response.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  authenticateCockpitRequest,
  authRequired,
  attemptLogin,
  SESSION_COOKIE,
} from "../src/runtime/cloudflare-cockpit-auth.js";
import { handleCockpitRequest, createCockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";

const base = "https://cockpit.local";
const TOKEN = "test-access-token-value-123";

describe("cockpit auth — pure policy", () => {
  it("not required when no token, not production, no flag", () => {
    assert.equal(authRequired({}), false);
  });
  it("required in production", () => {
    assert.equal(authRequired({ APP_ENV: "production" }), true);
  });
  it("required when a token is configured", () => {
    assert.equal(authRequired({ HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN }), true);
  });
  it("dev bypass disables auth ONLY outside production", () => {
    assert.equal(authRequired({ HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN, HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true" }), false);
    assert.equal(authRequired({ APP_ENV: "production", HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN, HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true" }), true);
  });

  it("production with no token → misconfigured (fail closed)", () => {
    const res = authenticateCockpitRequest(new Request(base), { APP_ENV: "production" });
    assert.equal(res.ok, false);
    assert.equal(res.mode, "misconfigured");
  });

  it("bearer + cookie auth succeed with the right token, fail otherwise", () => {
    const env = { HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN };
    assert.equal(authenticateCockpitRequest(new Request(base, { headers: { authorization: `Bearer ${TOKEN}` } }), env).ok, true);
    assert.equal(authenticateCockpitRequest(new Request(base, { headers: { cookie: `${SESSION_COOKIE}=${TOKEN}` } }), env).ok, true);
    assert.equal(authenticateCockpitRequest(new Request(base, { headers: { authorization: "Bearer nope" } }), env).ok, false);
    assert.equal(authenticateCockpitRequest(new Request(base), env).ok, false);
  });

  it("login builds a hardened cookie and refuses wrong/empty tokens", () => {
    const env = { HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN };
    const ok = attemptLogin(env, TOKEN);
    assert.equal(ok.ok, true);
    assert.match(ok.setCookie ?? "", /HttpOnly/);
    assert.match(ok.setCookie ?? "", /SameSite=Strict/);
    assert.equal(attemptLogin(env, "wrong").status, 401);
    assert.equal(attemptLogin(env, "").status, 400);
    assert.equal(attemptLogin({}, TOKEN).status, 503, "login unavailable when no token configured");
  });
});

describe("cockpit auth — at the handler", () => {
  let dir: string;
  let ctx: CockpitWorkerContext;
  before(async () => { dir = await mkdtemp(path.join(tmpdir(), "cf-auth-")); ctx = await createCockpitWorkerContext({ cwd: dir }); });
  after(async () => { await rm(dir, { recursive: true, force: true }); });

  const tokenEnv = { HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN };

  it("unauthenticated API → 401", async () => {
    for (const route of ["/api/state", "/api/freshness", "/api/read-models/status", "/api/proposals", "/api/debug/status"]) {
      const res = await handleCockpitRequest(new Request(`${base}${route}`), tokenEnv, ctx);
      assert.equal(res.status, 401, `${route} must be 401 without auth`);
    }
    const ask = await handleCockpitRequest(
      new Request(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "Daily brief" }) }),
      tokenEnv,
      ctx
    );
    assert.equal(ask.status, 401);
  });

  it("/health stays public even when auth is configured", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/health`), tokenEnv, ctx);
    assert.equal(res.status, 200);
  });

  it("unauthenticated UI shows a login screen (200), never the token", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/`), tokenEnv, ctx);
    assert.equal(res.status, 200);
    const body = await res.text();
    assert.ok(body.includes("<!doctype html>"));
    assert.match(body, /sign in/i);
    assert.ok(!body.includes(TOKEN), "login page must not contain the token");
  });

  it("production with no token fails closed: 401 API + LOCKED page", async () => {
    const env = { APP_ENV: "production" };
    const api = await handleCockpitRequest(new Request(`${base}/api/state`), env, ctx);
    assert.equal(api.status, 401);
    const home = await handleCockpitRequest(new Request(`${base}/`), env, ctx);
    assert.equal(home.status, 200);
    assert.match(await home.text(), /locked/i);
  });

  it("bearer-authenticated requests succeed and never leak the token", async () => {
    const res = await handleCockpitRequest(new Request(`${base}/api/state`, { headers: { authorization: `Bearer ${TOKEN}` } }), tokenEnv, ctx);
    assert.equal(res.status, 200);
    assert.ok(!(await res.text()).includes(TOKEN));
  });

  it("login route sets a session cookie for the correct token", async () => {
    const res = await handleCockpitRequest(
      new Request(`${base}/api/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: TOKEN }) }),
      tokenEnv,
      ctx
    );
    assert.equal(res.status, 200);
    assert.match(res.headers.get("set-cookie") ?? "", new RegExp(`${SESSION_COOKIE}=`));
  });

  it("dev bypass opens the cockpit locally", async () => {
    const env = { HARTOS_COCKPIT_ACCESS_TOKEN: TOKEN, HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true" };
    const res = await handleCockpitRequest(new Request(`${base}/api/state`), env, ctx);
    assert.equal(res.status, 200);
  });
});
