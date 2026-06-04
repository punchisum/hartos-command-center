/**
 * Identifier Contract
 *
 * Rules (from Ops Agent v2 production lessons):
 *   1. Internal Supabase IDs are ALWAYS uuid.
 *   2. External provider IDs (Telegram, ClickUp, etc.) are ALWAYS text/string.
 *   3. External IDs NEVER enter UUID columns.
 *   4. If an internal UUID cannot be resolved, set the uuid column to null.
 *   5. External refs are ALWAYS preserved in metadata JSONB.
 *   6. Validate UUID format before every Supabase insert.
 *
 * Ops Agent v2 bug this prevents:
 *   digest_proposals.target_record_id is uuid.
 *   Code attempted to insert a ClickUp task ID (string) directly.
 *   Result: Postgres 22P02 invalid_text_representation.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

export function requireUuid(value: unknown, field: string): string {
  if (!isValidUuid(value)) {
    const preview =
      typeof value === "string" ? value.slice(0, 60) : typeof value;
    throw new Error(
      `${field} must be a valid UUID. Got: "${preview}". ` +
        `External provider IDs (ClickUp, Telegram, etc.) must NOT be used as UUID columns.`
    );
  }
  return value;
}

export function safeUuidOrNull(value: unknown): string | null {
  return isValidUuid(value) ? value : null;
}

/**
 * Resolve an external provider ID to an internal Supabase UUID.
 * If resolution fails, returns null for internal_id.
 * External ID is always preserved.
 */
export function resolveInternalId(
  externalId: string,
  lookup: Map<string, string>
): { internal_id: string | null; external_id: string } {
  const resolved = lookup.get(externalId) ?? null;
  const internal_id = resolved !== null ? safeUuidOrNull(resolved) : null;
  return { internal_id, external_id: externalId };
}

/**
 * Build identifier fields for a Supabase row that may have an unresolved target.
 * external IDs NEVER enter UUID columns — they go into metadata.
 */
export function buildIdentifiers(params: {
  internalId: string | null;
  externalProviderId: string;
  provider: string;
}): {
  internal_id: string | null;
  metadata: Record<string, string>;
} {
  if (params.internalId !== null && !isValidUuid(params.internalId)) {
    throw new Error(
      `internalId must be a valid UUID or null. Got: "${params.internalId}". ` +
        `Do not pass external provider IDs (${params.provider}) as internalId.`
    );
  }
  return {
    internal_id: params.internalId,
    metadata: {
      [`${params.provider}_id`]: params.externalProviderId,
    },
  };
}

/**
 * Telegram-specific ID helpers.
 * Telegram chat_id and user_id are numbers in the API but must be stored as text.
 * They NEVER go into UUID columns.
 */
export function telegramChatIdToText(chatId: number | string): string {
  return String(chatId);
}

export function telegramUserIdToText(userId: number | string): string {
  return String(userId);
}

/**
 * Validate that an object intended for Supabase insert does not contain
 * external provider IDs in columns that expect UUIDs.
 *
 * Pass the row and the set of known UUID column names.
 * Throws if any UUID column contains a non-UUID value.
 */
export function validateRowIdentifiers(
  row: Record<string, unknown>,
  uuidColumns: string[]
): void {
  for (const col of uuidColumns) {
    const value = row[col];
    if (value === null || value === undefined) continue;
    if (!isValidUuid(value)) {
      throw new Error(
        `Column "${col}" expects a UUID but got: "${String(value).slice(0, 60)}". ` +
          `External provider IDs must go in metadata JSONB, not UUID columns.`
      );
    }
  }
}
