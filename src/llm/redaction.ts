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
  /\bsk-[A-Za-z0-9_-]{16,}/g, // OpenAI-style. \b anchors to a token boundary so benign
  // hyphenated words ("ri·sk-insurance-facility-for-u", "ta·sk-management-...") don't false-match;
  // a real key is always a standalone token, so this keeps every true positive.
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g, // JWT (Supabase keys are JWTs)
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/g, // 2-segment JWT-ish
  /gh[pousr]_[A-Za-z0-9_]{20,}/g, // GitHub tokens
  /xox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack
  /tr_(?:dev|prod)_[A-Za-z0-9]{16,}/g, // Trigger.dev
  // Telegram — the API URL embeds the bot token; a network error can leak the whole URL.
  // Redact the URL form first (so the token never survives in a URL), then the bare token form.
  /api\.telegram\.org\/bot[A-Za-z0-9:_-]+/gi, // Telegram API URL with embedded token
  /\d{6,12}:[A-Za-z0-9_-]{30,}/g, // Telegram bot token (<bot id>:<secret>)
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
 * Fail-closed secret guard. Deep-walks an arbitrary JSON-ish value and THROWS if
 * any string within it looks like a secret/token. Use this on anything assembled
 * in Node before it leaves the process boundary (rendered to the browser/Worker
 * or persisted to disk) — a bundle/summary must never carry a raw secret.
 *
 * Unlike `redact`/`redactDeep` (which silently scrub), this surfaces the leak so
 * the caller can refuse to render rather than ship a half-redacted artifact.
 */
export function assertNoSecrets(value: unknown, context = "value"): void {
  const offending = findSecret(value);
  if (offending !== null) {
    throw new Error(
      `Secret-looking string detected in ${context} (at ${offending}). ` +
        "Bundles and summaries must never contain raw secrets before they leave Node."
    );
  }
}

/** Walk a JSON-ish value; return the JSON path of the first secret-looking string, else null. */
function findSecret(value: unknown, path = "$"): string | null {
  if (typeof value === "string") {
    return containsSecret(value) ? path : null;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const hit = findSecret(value[i], `${path}[${i}]`);
      if (hit !== null) return hit;
    }
    return null;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      const hit = findSecret(v, `${path}.${k}`);
      if (hit !== null) return hit;
    }
  }
  return null;
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
