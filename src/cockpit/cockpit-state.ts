/**
 * src/cockpit/cockpit-state.ts
 *
 * Request validation + id helpers for the cockpit. Validation rejects empty,
 * oversized, and secret-looking input so a future hosted cockpit cannot leak
 * secrets into Orchestrator runs or local reports.
 *
 * No network. No mutation.
 */

import type { CockpitMode, RequestValidation } from "./cockpit-types.js";

export const MAX_REQUEST_LENGTH = 4000;
export const DEFAULT_MODE: CockpitMode = "local";

/** Secret-looking patterns rejected from cockpit input and reports. */
const SECRET_PATTERNS = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{20,}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

export function looksLikeSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}

/** Validate an Ask HartOS request. Never throws. */
export function validateRequest(raw: unknown): RequestValidation {
  if (typeof raw !== "string") {
    return { ok: false, error: "Request must be a string." };
  }
  const value = raw.trim();
  if (value.length === 0) {
    return { ok: false, error: "Request must be a non-empty string." };
  }
  if (value.length > MAX_REQUEST_LENGTH) {
    return { ok: false, error: `Request exceeds maximum length of ${MAX_REQUEST_LENGTH} characters.` };
  }
  if (looksLikeSecret(value)) {
    return { ok: false, error: "Request contains secret-looking content and was rejected." };
  }
  return { ok: true, value };
}

let counter = 0;

function shortRand(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function createThreadId(now: Date = new Date()): string {
  return `thread-${now.toISOString().replace(/[:.]/g, "-")}-${shortRand()}`;
}

export function createRequestId(now: Date = new Date()): string {
  return `req-${now.toISOString().replace(/[:.]/g, "-")}-${shortRand()}`;
}
