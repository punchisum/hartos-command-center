/**
 * src/command-center/data-contract.ts
 *
 * Assembles the full Command Center data contract: which cards exist, which
 * groups they belong to, and which LOCAL source roots are permitted. The data
 * contract is the single artifact a future cockpit UI consumes to know what it
 * may display and where each card's data comes from.
 *
 * No external/network sources are ever permitted. Building the contract also
 * asserts the action and approval contracts are internally consistent.
 */

import type { CardDefinition, DataContract } from "./command-center-types.js";
import { CARD_REGISTRY, allSourcePaths } from "./card-registry.js";
import { CARD_GROUPS } from "./command-center-types.js";
import { assertNoDangerousReadOnly } from "./action-contract.js";
import { assertNoDangerousWithoutApproval } from "./approval-contract.js";

/**
 * The only local roots the Command Center is allowed to read. Everything else —
 * networks, providers, Supabase — is out of contract by construction.
 */
export const ALLOWED_SOURCE_ROOTS: string[] = [
  "hartos-reports/",
  "beezulbub-reports/",
  "launch-reports/",
  "production-reports/",
  "bootstrap-reports/",
  "command-center-reports/",
  "capabilities/capability-registry.json",
  "capabilities/provenance-ledger.json",
  "packs/*/pack.manifest.json",
  "docs/HANDOVER.md",
  "docs/*.md",
];

/** A source path is in-contract if it matches one of the allowed roots. */
export function isAllowedSource(sourcePath: string): boolean {
  for (const root of ALLOWED_SOURCE_ROOTS) {
    if (sourcePath === root) return true;
    // Directory roots end with "/"; allow anything under them.
    if (root.endsWith("/") && sourcePath.startsWith(root)) return true;
    // Glob roots like "docs/*.md": compare the directory prefix.
    if (root.includes("*")) {
      const prefix = root.slice(0, root.indexOf("*"));
      if (sourcePath.startsWith(prefix)) return true;
    }
  }
  return false;
}

/**
 * Build the assembled data contract. Throws if any card references a source
 * outside the allowed roots, or if the action/approval contracts are unsafe.
 */
export function buildDataContract(now: Date = new Date()): DataContract {
  assertNoDangerousReadOnly();
  assertNoDangerousWithoutApproval();

  for (const card of CARD_REGISTRY) {
    for (const sourcePath of card.sourcePaths) {
      if (!isAllowedSource(sourcePath)) {
        throw new Error(
          `Data contract violation: card "${card.id}" references out-of-contract source "${sourcePath}".`
        );
      }
    }
    if (card.allowedActions.length === 0) {
      throw new Error(`Data contract violation: card "${card.id}" has no allowed actions.`);
    }
    if (card.blockedActions.length === 0) {
      throw new Error(`Data contract violation: card "${card.id}" has no blocked actions.`);
    }
  }

  return {
    generatedAt: now.toISOString(),
    cardCount: CARD_REGISTRY.length,
    groups: [...CARD_GROUPS],
    allowedSourceRoots: [...ALLOWED_SOURCE_ROOTS],
    cards: CARD_REGISTRY.map(cloneCard),
  };
}

function cloneCard(card: CardDefinition): CardDefinition {
  return {
    ...card,
    sourcePaths: [...card.sourcePaths],
    allowedActions: [...card.allowedActions],
    blockedActions: [...card.blockedActions],
  };
}
