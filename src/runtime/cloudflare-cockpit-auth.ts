/**
 * src/runtime/cloudflare-cockpit-auth.ts
 *
 * Phase 16 — access-token auth gate for the hosted Command Center cockpit.
 *
 * Deliberately tiny: no OAuth, no user database, no auth framework. A single
 * shared access token (HARTOS_COCKPIT_ACCESS_TOKEN, set as a Wrangler secret)
 * gates every protected route. The token is accepted as either:
 *
 *   - Authorization: Bearer <token>            (API clients / scripts)
 *   - Cookie: hartos_cockpit_session=<token>    (set by the login form)
 *
 * Fail-closed doctrine:
 *   - In production (APP_ENV=production), or whenever a token IS configured, or
 *     whenever HARTOS_COCKPIT_REQUIRE_AUTH=true, auth is REQUIRED. If auth is
 *     required but no token is configured, every protected route is denied
 *     ("misconfigured" → fail closed; nobody gets in).
 *   - A local dev bypass (HARTOS_COCKPIT_DEV_AUTH_BYPASS=true) opens the cockpit
 *     ONLY when not in production. It is ignored in production.
 *   - When auth is NOT required (no token, not production, no require flag) the
 *     cockpit is open — this is the default for local Node tests / dry-runs.
 *
 * The token VALUE is never logged, never returned in a body, never put in HTML.
 */

import type { CloudflareCockpitEnv } from "./cloudflare-cockpit-types.js";
import { safeEqual } from "../lib/safe-equal.js";

export const ACCESS_TOKEN_ENV = "HARTOS_COCKPIT_ACCESS_TOKEN";
export const DEV_BYPASS_ENV = "HARTOS_COCKPIT_DEV_AUTH_BYPASS";
export const REQUIRE_AUTH_ENV = "HARTOS_COCKPIT_REQUIRE_AUTH";
export const SESSION_COOKIE = "hartos_cockpit_session";

/** How a request was (or was not) authenticated. */
export type AuthMode =
  | "bearer"
  | "cookie"
  | "dev_bypass"
  | "open"
  | "unauthenticated"
  | "misconfigured";

export interface AuthResult {
  ok: boolean;
  mode: AuthMode;
  /** Safe, human-readable reason. Never contains the token value. */
  reason: string;
}

function trimmed(env: CloudflareCockpitEnv, name: string): string {
  const v = env[name];
  return typeof v === "string" ? v.trim() : "";
}

export function isProduction(env: CloudflareCockpitEnv): boolean {
  return trimmed(env, "APP_ENV").toLowerCase() === "production";
}

/** True only when a non-empty access token is configured server-side. */
export function authConfigured(env: CloudflareCockpitEnv): boolean {
  return trimmed(env, ACCESS_TOKEN_ENV).length > 0;
}

/** Dev bypass is honored ONLY outside production. */
export function devBypassEnabled(env: CloudflareCockpitEnv): boolean {
  return env[DEV_BYPASS_ENV] === "true" && !isProduction(env);
}

/**
 * Whether auth must be enforced for this environment. Required in production, or
 * when a token is configured, or when explicitly requested. The dev bypass
 * (non-prod only) turns enforcement off.
 */
export function authRequired(env: CloudflareCockpitEnv): boolean {
  if (devBypassEnabled(env)) return false;
  return isProduction(env) || authConfigured(env) || env[REQUIRE_AUTH_ENV] === "true";
}

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1]!.trim() : null;
}

export function extractCookieToken(request: Request): string | null {
  const cookie = request.headers.get("cookie");
  if (!cookie) return null;
  for (const part of cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (key === SESSION_COOKIE) {
      try {
        return decodeURIComponent(part.slice(eq + 1).trim());
      } catch {
        return part.slice(eq + 1).trim();
      }
    }
  }
  return null;
}

/**
 * Authenticate a request against the configured access token. Pure: depends
 * only on the request headers + env. Never throws, never leaks the token.
 */
export function authenticateCockpitRequest(request: Request, env: CloudflareCockpitEnv): AuthResult {
  if (devBypassEnabled(env)) {
    return { ok: true, mode: "dev_bypass", reason: "Dev auth bypass enabled (non-production)." };
  }
  if (!authRequired(env)) {
    return { ok: true, mode: "open", reason: "Auth not required (no token configured, not production)." };
  }
  if (!authConfigured(env)) {
    // Required but no token → fail closed. This is the production-misconfig case.
    return { ok: false, mode: "misconfigured", reason: "Access token is not configured; failing closed." };
  }
  const token = trimmed(env, ACCESS_TOKEN_ENV);
  const bearer = extractBearerToken(request);
  if (bearer && safeEqual(bearer, token)) {
    return { ok: true, mode: "bearer", reason: "Authenticated via bearer token." };
  }
  const cookie = extractCookieToken(request);
  if (cookie && safeEqual(cookie, token)) {
    return { ok: true, mode: "cookie", reason: "Authenticated via session cookie." };
  }
  return { ok: false, mode: "unauthenticated", reason: "Missing or invalid access token." };
}

export interface LoginResult {
  ok: boolean;
  /** Set-Cookie header value when ok; null otherwise. Never contains anything but the token. */
  setCookie: string | null;
  status: number;
  reason: string;
}

/**
 * Validate a login attempt and, on success, build a hardened Set-Cookie header.
 * Cookie flags: HttpOnly (no JS access), Secure (HTTPS only), SameSite=Strict
 * (no cross-site send), Path=/. Max-Age defaults to 12h.
 */
export function attemptLogin(
  env: CloudflareCockpitEnv,
  submittedToken: unknown,
  options: { maxAgeSeconds?: number; secure?: boolean } = {}
): LoginResult {
  if (!authConfigured(env)) {
    return { ok: false, setCookie: null, status: 503, reason: "Login unavailable: access token is not configured." };
  }
  if (typeof submittedToken !== "string" || submittedToken.trim().length === 0) {
    return { ok: false, setCookie: null, status: 400, reason: "A non-empty token is required." };
  }
  const token = trimmed(env, ACCESS_TOKEN_ENV);
  if (!safeEqual(submittedToken.trim(), token)) {
    return { ok: false, setCookie: null, status: 401, reason: "Invalid token." };
  }
  const maxAge = options.maxAgeSeconds ?? 12 * 60 * 60;
  const secure = options.secure ?? true;
  const flags = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    secure ? "Secure" : "",
    "SameSite=Strict",
    "Path=/",
    `Max-Age=${maxAge}`,
  ].filter(Boolean);
  return { ok: true, setCookie: flags.join("; "), status: 200, reason: "Authenticated." };
}

/** A Set-Cookie value that immediately expires the session cookie (logout). */
export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`;
}
