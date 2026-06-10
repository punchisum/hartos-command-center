/**
 * src/beezulbub/scout-vault-reader.ts — NODE host: read filed capability scouts from the vault.
 *
 * Reads HartOS/Capability Scout/*.md and parses each back into a CapabilityScoutSummary (via the
 * pure parser), so a host can feed Beezulbub's filed scouts to Wolverine (capability-risk audit)
 * and Prophet (latent-gap / no-clean-path forecast). Read-only; returns [] when the folder is absent.
 */

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseCapabilityScoutNote, type CapabilityScoutSummary } from "./scout-summary.js";

export async function readCapabilityScouts(vault: string | undefined): Promise<CapabilityScoutSummary[]> {
  if (!vault || vault.trim().length === 0) return [];
  const dir = path.join(vault, "HartOS", "Capability Scout");
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return []; // folder doesn't exist yet (no scouts filed) — honest empty
  }
  const out: CapabilityScoutSummary[] = [];
  for (const e of entries) {
    if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
    try {
      const summary = parseCapabilityScoutNote(await readFile(path.join(dir, e.name), "utf8"));
      if (summary) out.push(summary);
    } catch {
      /* skip an unreadable note */
    }
  }
  return out;
}
