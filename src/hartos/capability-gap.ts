/**
 * src/hartos/capability-gap.ts
 *
 * Capability gap detection.
 * Compares a request's required capabilities against the capability registry
 * and provenance ledger, and classifies each capability's usability.
 *
 * Read-only. No network. No mutation.
 *
 * Usability rules:
 *   available / verified  + provenance → usable
 *   verified/available WITHOUT provenance → not_usable (provenance required)
 *   implementation_draft  → planning_only (build planning, NOT production)
 *   pack_skeleton_created → not_usable (needs implementation/verification)
 *   missing               → missing (recommend Beezulbub scout/digest/pack)
 */

import path from "node:path";
import type {
  CapabilityGapItem,
  CapabilityGapResult,
  CapabilityUsability,
} from "./orchestrator-types.js";
import { detectBuildTarget, requiredCapabilitiesFor } from "./request-classifier.js";
import { loadRegistry } from "../beezulbub/capability-registry.js";
import { loadLedger, hasProvenance } from "../beezulbub/provenance-ledger.js";

const DEFAULT_REGISTRY_PATH = "capabilities/capability-registry.json";
const DEFAULT_LEDGER_PATH = "capabilities/provenance-ledger.json";

export interface CapabilityGapOptions {
  registryPath?: string;
  ledgerPath?: string;
  cwd?: string;
  /** Override the required capabilities instead of deriving from the request. */
  requiredCapabilities?: string[];
}

function usabilityFor(
  registryStatus: string,
  hasProv: boolean
): { usability: CapabilityUsability; recommendation: string; beezulbubAction: string | null } {
  switch (registryStatus) {
    case "available":
    case "verified":
      if (hasProv) {
        return {
          usability: "usable",
          recommendation: "Usable. Compose directly into the build.",
          beezulbubAction: null,
        };
      }
      return {
        usability: "not_usable",
        recommendation: "Status is usable but provenance is missing — record provenance before relying on it.",
        beezulbubAction: "beezulbub:pack-generate (re-record provenance for this capability)",
      };
    case "implementation_draft":
      return {
        usability: "planning_only",
        recommendation: "Implementation draft exists — usable for build planning only, NOT production.",
        beezulbubAction: "beezulbub:pack-verify then beezulbub:pack-promote --to=verified (after review)",
      };
    case "pack_skeleton_created":
      return {
        usability: "not_usable",
        recommendation: "Only a skeleton exists — not usable yet. Implement before relying on it.",
        beezulbubAction: "beezulbub:pack-implement (after approval)",
      };
    case "missing":
      return {
        usability: "missing",
        recommendation: "Capability not in registry — acquire via Beezulbub.",
        beezulbubAction: "beezulbub:scout / beezulbub:digest / beezulbub:pack-generate for this capability",
      };
    default:
      return {
        usability: "not_usable",
        recommendation: `Registry status "${registryStatus}" is not production-usable.`,
        beezulbubAction: "beezulbub:pack-verify / beezulbub:pack-implement as appropriate",
      };
  }
}

export async function detectCapabilityGaps(
  request: string,
  options: CapabilityGapOptions = {}
): Promise<CapabilityGapResult> {
  const cwd = options.cwd ?? process.cwd();
  const registryPath = options.registryPath
    ? path.resolve(cwd, options.registryPath)
    : path.resolve(cwd, DEFAULT_REGISTRY_PATH);
  const ledgerPath = options.ledgerPath
    ? path.resolve(cwd, options.ledgerPath)
    : path.resolve(cwd, DEFAULT_LEDGER_PATH);

  const buildTarget = detectBuildTarget(request);
  const requiredCapabilities =
    options.requiredCapabilities ?? requiredCapabilitiesFor(buildTarget);

  // loadRegistry / loadLedger never throw — they return safe empty shapes.
  const registry = await loadRegistry(registryPath);
  const ledger = await loadLedger(ledgerPath);

  const items: CapabilityGapItem[] = [];
  const usableCapabilities: string[] = [];
  const planningOnlyCapabilities: string[] = [];
  const missingCapabilities: string[] = [];

  for (const capId of requiredCapabilities) {
    const entry = registry.capabilities[capId];
    const registryStatus = entry ? entry.status : "missing";
    const hasProv = hasProvenance(ledger, capId);
    const { usability, recommendation, beezulbubAction } = usabilityFor(registryStatus, hasProv);

    items.push({
      capabilityId: capId,
      registryStatus,
      usability,
      hasProvenance: hasProv,
      recommendation,
      recommendedBeezulbubAction: beezulbubAction,
    });

    if (usability === "usable") usableCapabilities.push(capId);
    else if (usability === "planning_only") planningOnlyCapabilities.push(capId);
    else missingCapabilities.push(capId);
  }

  return {
    request,
    buildTarget,
    requiredCapabilities,
    items,
    usableCapabilities,
    planningOnlyCapabilities,
    missingCapabilities,
  };
}
