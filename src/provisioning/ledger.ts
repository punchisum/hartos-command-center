/**
 * src/provisioning/ledger.ts
 *
 * Provision ledger I/O.
 * Tracks what was provisioned, when, and with what outcome.
 * NEVER stores secrets, tokens, or raw keys.
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  ProvisionLedger,
  LedgerEntry,
  ProvisionResult,
  ProvisionEnvironment,
} from "./types.js";

const LEDGER_FILENAME = "provision-ledger.json";

export function ledgerPath(reportsDir: string): string {
  return path.join(reportsDir, LEDGER_FILENAME);
}

export async function loadLedger(reportsDir: string): Promise<ProvisionLedger | null> {
  const file = ledgerPath(reportsDir);
  if (!existsSync(file)) return null;
  const content = await readFile(file, "utf8");
  return JSON.parse(content) as ProvisionLedger;
}

export async function saveLedger(
  reportsDir: string,
  ledger: ProvisionLedger
): Promise<void> {
  await mkdir(reportsDir, { recursive: true });
  await writeFile(ledgerPath(reportsDir), JSON.stringify(ledger, null, 2) + "\n", "utf8");
}

export function buildLedgerEntries(
  result: ProvisionResult,
  environment: ProvisionEnvironment
): LedgerEntry[] {
  return result.results.map((r) => ({
    timestamp: r.timestamp,
    environment,
    provider: r.step.provider,
    stepId: r.step.id,
    action: r.step.action,
    status: r.status,
    message: r.message,
    rollbackAvailable: Boolean(r.step.rollback),
    ...(r.status === "failed" ? { failureCode: "STEP_FAILED" } : {}),
  }));
}

export async function appendToLedger(
  reportsDir: string,
  agentName: string,
  entries: LedgerEntry[]
): Promise<ProvisionLedger> {
  const existing = await loadLedger(reportsDir);
  const ledger: ProvisionLedger = {
    agentName,
    entries: [...(existing?.entries ?? []), ...entries],
    lastUpdated: new Date().toISOString(),
  };
  await saveLedger(reportsDir, ledger);
  return ledger;
}

/**
 * Validate that the ledger contains no raw secrets.
 * Throws if any secret pattern is detected.
 */
export function assertLedgerNoSecrets(ledger: ProvisionLedger): void {
  const raw = JSON.stringify(ledger);
  const secretPatterns = [
    /sk-[A-Za-z0-9_-]{20,}/,
    /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  ];
  for (const pattern of secretPatterns) {
    if (pattern.test(raw)) {
      throw new Error(
        "Secret-looking value detected in provisioning ledger. " +
          "Ledger must never contain raw secrets."
      );
    }
  }
}
