/**
 * src/lib/supabase-tls.ts — synchronous Supabase TLS config (CA-based strict verification).
 *
 * Shared helper for the Node-only pg connection paths (cockpit proposal spine, executor stores).
 * Builds the `ssl` block a pg Pool expects, choosing STRICT chain verification whenever a CA is
 * supplied and otherwise preserving today's relaxed behavior (no regression). Synchronous: the
 * only side effect is an optional `fs.readFileSync` of a LOCAL CA file — never a live action.
 *
 * Permanent fix for "relaxed" TLS: set HARTOS_SUPABASE_CA (the PEM string) or
 * HARTOS_SUPABASE_CA_PATH (a path to the PEM) so strict verification succeeds.
 */

import { readFileSync } from "node:fs";

export type SupabaseTlsMode = "strict" | "relaxed";

export interface SupabaseSslConfig {
  ssl: { ca?: string; rejectUnauthorized: boolean };
  tlsMode: SupabaseTlsMode;
}

/** The env var holding the Supabase CA bundle inline as a PEM string. */
export const SUPABASE_CA_ENV = "HARTOS_SUPABASE_CA";
/** The env var holding a path to a LOCAL Supabase CA PEM file (read synchronously). */
export const SUPABASE_CA_PATH_ENV = "HARTOS_SUPABASE_CA_PATH";

/**
 * Resolve the pg `ssl` block + the resulting TLS mode from env.
 *
 *   - HARTOS_SUPABASE_CA set (inline PEM)  → strict: verify the chain against that CA.
 *   - else HARTOS_SUPABASE_CA_PATH set     → read the PEM (utf8); strict on success,
 *                                            relaxed if the file can't be read.
 *   - else                                 → relaxed: rejectUnauthorized:false (today's behavior).
 *
 * Synchronous and pure except the optional local-file read above.
 */
export function buildSupabaseSsl(env: Record<string, string | undefined>): SupabaseSslConfig {
  const inlineCa = env[SUPABASE_CA_ENV];
  if (inlineCa && inlineCa.trim().length > 0) {
    return { ssl: { ca: inlineCa, rejectUnauthorized: true }, tlsMode: "strict" };
  }

  const caPath = env[SUPABASE_CA_PATH_ENV];
  if (caPath && caPath.trim().length > 0) {
    try {
      const pem = readFileSync(caPath, "utf8");
      return { ssl: { ca: pem, rejectUnauthorized: true }, tlsMode: "strict" };
    } catch {
      // The CA path was supplied but unreadable: fall back to today's relaxed behavior
      // rather than failing the connection outright (no regression).
      return { ssl: { rejectUnauthorized: false }, tlsMode: "relaxed" };
    }
  }

  return { ssl: { rejectUnauthorized: false }, tlsMode: "relaxed" };
}
