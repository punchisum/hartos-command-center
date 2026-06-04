/**
 * src/cockpit/sources/secret-guard.ts
 *
 * Phase 13 — safety guard for the read-only cockpit boundary. The cockpit must
 * NEVER use a Supabase service-role key. This decodes the (already-present) JWT
 * locally to inspect its `role` claim — it does not transmit or print the key.
 */

/** Decode a base64url segment to UTF-8 without throwing. */
function decodeSegment(seg: string): string {
  try {
    const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
    const pad = b64.length % 4 === 0 ? "" : "=".repeat(4 - (b64.length % 4));
    return Buffer.from(b64 + pad, "base64").toString("utf8");
  } catch {
    return "";
  }
}

/**
 * True when a key is (or looks like) a Supabase service-role key. Such keys
 * must be rejected for read-only cockpit use. Conservative: any explicit
 * service_role marker counts.
 */
export function isServiceRoleKey(key: string | undefined | null): boolean {
  if (!key) return false;
  const trimmed = key.trim();
  // Plain marker (e.g. a "service_role" labelled secret).
  if (/service_role/i.test(trimmed) && !trimmed.includes(".")) return true;
  // Supabase keys are JWTs: header.payload.signature
  const parts = trimmed.split(".");
  if (parts.length === 3) {
    const payload = decodeSegment(parts[1]!);
    if (/"role"\s*:\s*"service_role"/.test(payload)) return true;
  }
  return false;
}

/** Reason string (no secret value) for rejecting a service-role key. */
export const SERVICE_ROLE_REJECTION =
  "A Supabase service_role key was detected and rejected. Use a read-only anon/publishable key for the cockpit read boundary.";
