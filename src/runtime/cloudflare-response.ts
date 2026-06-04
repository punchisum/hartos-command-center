/**
 * src/runtime/cloudflare-response.ts
 *
 * Safe Response helpers for the hosted cockpit Worker. Every response carries
 * the conservative security headers and (default-denied) CORS. Error bodies are
 * safe JSON — never an env dump, never a stack trace, never a secret.
 */

import { SECURITY_HEADERS } from "./cloudflare-security.js";

function withSecurity(headers: Record<string, string>): Record<string, string> {
  return { ...SECURITY_HEADERS, ...headers };
}

export function jsonResponse(
  status: number,
  data: unknown,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: withSecurity({ "content-type": "application/json; charset=utf-8", ...extraHeaders }),
  });
}

export function htmlResponse(
  body: string,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(body, {
    status: 200,
    headers: withSecurity({ "content-type": "text/html; charset=utf-8", ...extraHeaders }),
  });
}

export function safeError(status: number, message: string, extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse(status, { error: message }, extraHeaders);
}

export function notFound(extraHeaders: Record<string, string> = {}): Response {
  return safeError(404, "Not found.", extraHeaders);
}

export function methodNotAllowed(extraHeaders: Record<string, string> = {}): Response {
  return jsonResponse(405, { error: "Method not allowed." }, { allow: "GET, POST, OPTIONS", ...extraHeaders });
}

export function payloadTooLarge(extraHeaders: Record<string, string> = {}): Response {
  return safeError(413, "Request body too large.", extraHeaders);
}
