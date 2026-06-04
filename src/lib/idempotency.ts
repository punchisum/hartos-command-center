const FORBIDDEN_KEY_SOURCES = new Set([
  "llm_generated_text",
  "user_free_text",
  "long_tokens_or_safeText_processed_strings",
]);

export interface IdempotencyPart {
  source: string;
  value: string;
}

export function makeIdempotencyKey(parts: IdempotencyPart[]): string {
  if (parts.length === 0) throw new Error("Idempotency key requires trusted parts");

  return parts
    .map((part) => {
      if (FORBIDDEN_KEY_SOURCES.has(part.source)) {
        throw new Error(`Forbidden idempotency source: ${part.source}`);
      }
      if (!part.value || part.value.length > 128) {
        throw new Error(`Unsafe idempotency value for source: ${part.source}`);
      }
      return `${part.source}:${part.value}`;
    })
    .join("|");
}
