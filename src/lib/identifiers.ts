const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function assertUuid(value: string | null | undefined, label: string): void {
  if (value === null || value === undefined) return;
  if (!UUID_PATTERN.test(value)) {
    throw new Error(`${label} must be a UUID. External provider IDs belong in text columns.`);
  }
}

export function normalizeExternalId(value: string | number): string {
  return String(value);
}
