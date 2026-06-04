/**
 * Idempotency Key Contract
 *
 * Rules (from Ops Agent v2 production lessons):
 *   1. Keys MUST be deterministic from trusted, controlled fields only.
 *   2. NEVER use LLM-generated text as any part of an idempotency key.
 *   3. NEVER use values that can be truncated or redacted (long tokens, free text).
 *   4. Detect same-batch duplicates before insert.
 *   5. Same key across runs = skip, do not re-insert.
 *
 * Ops Agent v2 bug this prevents:
 *   safeText() redacted long LLM-generated idempotency keys to "[redacted]",
 *   causing multiple rows with key="[redacted]" → Postgres 21000 unique violation.
 */

import { createHash } from "node:crypto";

/** Trusted field types for idempotency keys. */
export type TrustedKeyPart =
  | string  // uuid, date string, enum code, numeric ID
  | number; // record count, numeric ID

const MAX_PART_LENGTH = 200;
const LLM_TEXT_PATTERN = /\s{2,}|[.!?,;]{2,}|\b(the|and|or|is|a|an)\b/i;

/**
 * Build a deterministic idempotency key from trusted fields.
 * Throws if any part looks like LLM-generated free text.
 *
 * Good parts: record UUIDs, date strings, enum codes, job run IDs, batch IDs.
 * Bad parts: LLM summaries, user message text, safeText()-processed strings.
 */
export function makeIdempotencyKey(parts: TrustedKeyPart[]): string {
  for (const part of parts) {
    const str = String(part);

    if (str.length > MAX_PART_LENGTH) {
      throw new Error(
        `Idempotency key part too long (${str.length} chars). ` +
          `Likely LLM-generated or user text. Use a controlled field like a UUID or enum code.`
      );
    }

    if (LLM_TEXT_PATTERN.test(str)) {
      throw new Error(
        `Idempotency key part appears to be natural language: "${str.slice(0, 60)}...". ` +
          `Use a controlled field (UUID, date, enum code) — never LLM output.`
      );
    }
  }

  const raw = parts.map(String).join(":");

  // Hash if combined key is long, to avoid DB column length limits.
  if (raw.length > 128) {
    return "sha256:" + createHash("sha256").update(raw).digest("hex");
  }

  return raw;
}

/**
 * Detect duplicate idempotency keys within a single batch before DB insert.
 * Returns the duplicated keys.
 *
 * Use this before a bulk insert to catch same-batch collisions early.
 */
export function detectBatchDuplicates(keys: string[]): string[] {
  const seen = new Set<string>();
  const duplicates: string[] = [];
  for (const key of keys) {
    if (seen.has(key)) {
      duplicates.push(key);
    }
    seen.add(key);
  }
  return duplicates;
}

/**
 * Assert no batch duplicates before insert.
 * Throws with detail if duplicates are found.
 */
export function assertNoBatchDuplicates(keys: string[]): void {
  const dupes = detectBatchDuplicates(keys);
  if (dupes.length > 0) {
    throw new Error(
      `Duplicate idempotency keys detected in batch: ${dupes.slice(0, 5).join(", ")}. ` +
        `Check that key construction is correct and inputs are distinct.`
    );
  }
}

/**
 * Cross-run idempotency check.
 * Pass the set of keys that already exist in the DB.
 * Returns only the keys that are new and safe to insert.
 */
export function filterNewKeys(
  candidates: string[],
  existingKeys: Set<string>
): string[] {
  return candidates.filter((k) => !existingKeys.has(k));
}
