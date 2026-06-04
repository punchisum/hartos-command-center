/**
 * src/hartos/cto-review.ts
 *
 * CTO technical review module.
 * Handles ENGINEERING / BUILD matters only.
 *
 * Reads (read-only):
 *   capabilities/capability-registry.json
 *   capabilities/provenance-ledger.json
 *   packs/<name>/pack.manifest.json   (optional cross-check)
 *
 * Doctrine — a capability is only "usable" when ALL hold:
 *   - registry status is verified or available
 *   - provenance exists in the ledger
 * skeleton packs (pack_skeleton_created) are NOT usable.
 * implementation_draft is planning-only, never production.
 *
 * Produces recommendations only. No mutation. No provider calls.
 */

import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type {
  CtoReviewResult,
  TechnicalVerdict,
} from "./orchestrator-types.js";
import { detectBuildTarget, requiredCapabilitiesFor } from "./request-classifier.js";
import { detectCapabilityGaps } from "./capability-gap.js";

export interface CtoReviewOptions {
  registryPath?: string;
  ledgerPath?: string;
  packsDir?: string;
  cwd?: string;
  requiredCapabilities?: string[];
}

/** Read pack statuses for cross-reference (best-effort, never throws). */
async function readPackStatuses(packsDir: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  if (!existsSync(packsDir)) return result;
  try {
    const entries = await readdir(packsDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const manifestPath = path.join(packsDir, e.name, "pack.manifest.json");
      if (!existsSync(manifestPath)) continue;
      try {
        const m = JSON.parse(await readFile(manifestPath, "utf8")) as { packName?: string; status?: string; capabilities?: string[] };
        for (const cap of m.capabilities ?? []) {
          if (m.status) result[cap] = m.status;
        }
      } catch { /* skip corrupt manifest */ }
    }
  } catch { /* skip unreadable dir */ }
  return result;
}

export async function reviewCto(
  request: string,
  options: CtoReviewOptions = {}
): Promise<CtoReviewResult> {
  const cwd = options.cwd ?? process.cwd();
  const buildTarget = detectBuildTarget(request);
  const requiredCapabilities =
    options.requiredCapabilities ?? requiredCapabilitiesFor(buildTarget);

  const gap = await detectCapabilityGaps(request, {
    registryPath: options.registryPath,
    ledgerPath: options.ledgerPath,
    cwd,
    requiredCapabilities,
  });

  const packsDir = options.packsDir
    ? path.resolve(cwd, options.packsDir)
    : path.resolve(cwd, "packs");
  const packStatuses = await readPackStatuses(packsDir);

  const existingCapabilities = [...gap.usableCapabilities];
  const planningOnlyCapabilities = [...gap.planningOnlyCapabilities];
  const missingCapabilities = [...gap.missingCapabilities];

  const recommendedBeezulbubActions: string[] = [];
  for (const item of gap.items) {
    if (item.recommendedBeezulbubAction) {
      recommendedBeezulbubActions.push(`${item.capabilityId}: ${item.recommendedBeezulbubAction}`);
    }
  }

  const recommendedFactoryActions: string[] = [];
  if (missingCapabilities.length > 0 || planningOnlyCapabilities.length > 0) {
    recommendedFactoryActions.push("Run beezulbub:pack-verify on any implementation_draft packs before relying on them.");
  }
  if (existingCapabilities.length > 0) {
    recommendedFactoryActions.push("Compose usable capabilities via the Factory create-agent / pack pipeline (with approval gates).");
  }

  // Dependencies & risks
  const dependencies: string[] = [];
  const risks: string[] = [];
  if (planningOnlyCapabilities.length > 0) {
    risks.push(`Planning-only capabilities present (${planningOnlyCapabilities.join(", ")}) — NOT production-ready.`);
  }
  if (missingCapabilities.length > 0) {
    risks.push(`Missing capabilities (${missingCapabilities.join(", ")}) must be acquired before build.`);
    dependencies.push(`Beezulbub acquisition for: ${missingCapabilities.join(", ")}.`);
  }
  for (const cap of existingCapabilities) {
    const packStatus = packStatuses[cap];
    if (packStatus && packStatus !== "verified" && packStatus !== "available") {
      risks.push(`Registry marks ${cap} usable but its pack status is "${packStatus}" — reconcile before relying on it.`);
    }
  }

  // Technical verdict
  let technicalVerdict: TechnicalVerdict;
  if (requiredCapabilities.length === 0) {
    technicalVerdict = "insufficient_information";
  } else if (missingCapabilities.length === 0 && planningOnlyCapabilities.length === 0) {
    technicalVerdict = "build_with_existing_capabilities";
  } else if (existingCapabilities.length > 0) {
    technicalVerdict = "build_with_new_capabilities";
  } else {
    technicalVerdict = "needs_beezulbub_acquisition";
  }

  // Implementation sequence: usable first, then planning-only (after verify), then missing (after acquisition).
  const implementationSequence: string[] = [];
  if (existingCapabilities.length > 0) {
    implementationSequence.push(`Wire usable capabilities: ${existingCapabilities.join(", ")}.`);
  }
  if (planningOnlyCapabilities.length > 0) {
    implementationSequence.push(`Verify + promote implementation drafts: ${planningOnlyCapabilities.join(", ")}.`);
  }
  if (missingCapabilities.length > 0) {
    implementationSequence.push(`Acquire missing capabilities via Beezulbub: ${missingCapabilities.join(", ")}.`);
  }
  implementationSequence.push("Integrate under HartOS approval gates; no provider mutations without CONFIRM gates.");

  // Human approvals required
  const humanApprovalsRequired: string[] = [
    "Approval before beezulbub:pack-implement (BEEZULBUB_ALLOW_PACK_IMPLEMENT + --approve-implementation).",
    "Approval before beezulbub:pack-promote (BEEZULBUB_ALLOW_PACK_PROMOTE + --approve-promote).",
  ];
  if (missingCapabilities.length > 0) {
    humanApprovalsRequired.push("Approval before any pack generation from external sources.");
  }

  return {
    request,
    technicalVerdict,
    existingCapabilities,
    missingCapabilities,
    planningOnlyCapabilities,
    recommendedBeezulbubActions,
    recommendedFactoryActions,
    risks,
    dependencies,
    implementationSequence,
    humanApprovalsRequired,
  };
}
