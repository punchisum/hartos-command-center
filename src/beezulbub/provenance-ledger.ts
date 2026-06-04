/**
 * src/beezulbub/provenance-ledger.ts
 *
 * Provenance ledger — records the source, license, and absorption decisions.
 * Stored at: capabilities/provenance-ledger.json
 *
 * Rules:
 *   - No promotion to `available` without provenance.
 *   - thirdPartyCodeCopied must be false in Phase 11D/11E.
 *   - License must be recorded for every absorbed capability.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackManifest } from "./pack-types.js";

const DEFAULT_LEDGER_PATH = "capabilities/provenance-ledger.json";

// ─── Provenance entry ─────────────────────────────────────────────────────────

export interface ProvenanceEntry {
  capabilityId: string;
  packName: string;
  sourceRepo: string;
  sourceUrl: string | null;
  license: string | null;
  digestId?: string;
  verdict: string;
  scoreOverall: number;
  absorbed: string[];
  rejected: string[];
  /** Must be false in Phase 11D/11E — no source code copying yet */
  thirdPartyCodeCopied: boolean;
  createdAt: string;
}

export interface ProvenanceLedger {
  entries: ProvenanceEntry[];
  updatedAt: string;
}

// ─── Ledger I/O ───────────────────────────────────────────────────────────────

export async function loadLedger(ledgerPath: string): Promise<ProvenanceLedger> {
  if (!existsSync(ledgerPath)) {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
  try {
    const raw = await readFile(ledgerPath, "utf8");
    return JSON.parse(raw) as ProvenanceLedger;
  } catch {
    return { entries: [], updatedAt: new Date().toISOString() };
  }
}

export async function saveLedger(
  ledgerPath: string,
  ledger: ProvenanceLedger
): Promise<void> {
  await mkdir(path.dirname(ledgerPath), { recursive: true });
  ledger.updatedAt = new Date().toISOString();
  await writeFile(ledgerPath, JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

// ─── Ledger operations ────────────────────────────────────────────────────────

/** Record provenance after pack generation */
export async function recordProvenance(
  ledgerPath: string,
  manifest: PackManifest
): Promise<void> {
  const ledger = await loadLedger(ledgerPath);

  for (const capId of manifest.capabilities) {
    // Don't duplicate — update if exists
    const idx = ledger.entries.findIndex((e) => e.capabilityId === capId);
    const entry: ProvenanceEntry = {
      capabilityId: capId,
      packName: manifest.packName,
      sourceRepo: manifest.source.repoName,
      sourceUrl: manifest.source.sourceUrl,
      license: manifest.source.license,
      digestId: manifest.source.digestId,
      verdict: manifest.source.verdict,
      scoreOverall: manifest.source.scoreOverall,
      absorbed: manifest.absorb,
      rejected: manifest.reject,
      thirdPartyCodeCopied: false, // Always false in Phase 11D/11E
      createdAt: new Date().toISOString(),
    };

    if (idx >= 0) {
      ledger.entries[idx] = entry;
    } else {
      ledger.entries.push(entry);
    }
  }

  await saveLedger(ledgerPath, ledger);
}

/** Check if provenance exists for a capability */
export function hasProvenance(
  ledger: ProvenanceLedger,
  capabilityId: string
): boolean {
  return ledger.entries.some((e) => e.capabilityId === capabilityId);
}

/** Get provenance entry for a capability */
export function getProvenance(
  ledger: ProvenanceLedger,
  capabilityId: string
): ProvenanceEntry | undefined {
  return ledger.entries.find((e) => e.capabilityId === capabilityId);
}
