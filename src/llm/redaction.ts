/**
 * src/llm/redaction.ts
 *
 * Secret/token redaction. Reports and logs that pass through the LLM Gateway
 * must NEVER contain secrets. This module both detects and redacts token-like
 * strings (OpenAI/Supabase/Telegram/GitHub/Cloudflare/Trigger.dev keys, JWTs,
 * `Bearer ...`, `sk-...`). No network, no mutation.
 */

const REDACTION_PLACEHOLDER = "[REDACTED]";

/** Ordered list of secret-looking patterns. */
export const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT (Supabase keys are JWTs)
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, // 2-segment JWT-ish
  /gh[pousr]_[A-Za-z0-9_]{20,}/g, // GitHub tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /tr_(?:dev|prod)_[A-Za-z0-9]{16,}/g, // Trigger.dev
  /\bBearer\s+[A-Za-z0-9._\-]{16,}/gi, // Authorization headers
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
];

/** True when the text contains anything that looks like a secret/token. */
export function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => {
    p.lastIndex = 0;
    return p.test(text);
  });
}

/** Replace every secret-looking substring with a placeholder. Never throws. */
export function redact(text: string): string {
  if (typeof text !== "string") return text;
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    out = out.replace(pattern, REDACTION_PLACEHOLDER);
  }
  return out;
}

/**
 * Deep-redact an arbitrary JSON-ish value. Strings are redacted; objects and
 * arrays are walked. Used before writing usage logs / reports.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === "string") return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v)) as unknown as T;
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactDeep(v);
    }
    return out as unknown as T;
  }
  return value;
}
