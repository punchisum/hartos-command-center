/**
 * src/runtime/cloudflare-security.ts
 *
 * Security policy for the hosted cockpit. The hosted cockpit is treated as
 * future public-facing: server-side env only, no secrets in HTML/JS, method
 * allowlist, conservative (default-denied) CORS, body size limit, and NO
 * mutation endpoints. Action buttons remain disabled. Cloudflare Access is the
 * recommended front door before any production exposure (see docs).
 */

/** Maximum accepted request body (POST). */
export const MAX_REQUEST_BODY_BYTES = 64 * 1024;

/** Only these HTTP methods are accepted; everything else → 405. */
export const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"] as const;

/** The hosted cockpit never executes actions. */
export const ACTION_EXECUTION = "disabled" as const;

/** The hosted cockpit exposes no mutation endpoints. */
export const MUTATION_ENDPOINTS = "none" as const;

/** Conservative response headers applied to every response. */
export const SECURITY_HEADERS: Record<string, string> = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "DENY",
  "cache-control": "no-store",
};

/**
 * CORS is default-denied. Cross-origin access is only allowed if an explicit
 * allowed origin is configured server-side (CLOUDFLARE_COCKPIT_ALLOWED_ORIGIN)
 * and the request Origin matches it exactly. Otherwise no CORS headers are sent
 * (same-origin only).
 */
export function corsHeaders(
  env: Record<string, string | undefined>,
  requestOrigin: string | null
): Record<string, string> {
  const allowed = env["CLOUDFLARE_COCKPIT_ALLOWED_ORIGIN"];
  if (!allowed || !requestOrigin || requestOrigin !== allowed) return {};
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "Origin",
  };
}

/** The security checklist surfaced in reports/docs. */
export const SECURITY_CHECKLIST: string[] = [
  "All provider keys stay server-side; never exposed to the frontend.",
  "No secrets in served HTML or client JS.",
  "Action execution is disabled; all action buttons render disabled.",
  "No mutation endpoints exist (read-only state/reports/threads only).",
  "Request body size is limited; oversized/invalid/secret-looking input is rejected.",
  "HTTP method allowlist enforced (GET, POST, OPTIONS).",
  "CORS is default-denied unless an allowed origin is explicitly configured.",
  "Cloudflare Access is recommended before any production exposure.",
];
