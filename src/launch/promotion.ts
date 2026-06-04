/**
 * src/launch/promotion.ts
 *
 * Production promotion gate logic and staging proof verification.
 * Phase 9: before any production mutation, staging must be proven green.
 *
 * Rules:
 *   - ALLOW_PRODUCTION_PROMOTION=true required for any promotion
 *   - CONFIRM_PRODUCTION_DEPLOY=true required for any production mutation
 *   - ALLOW_AUTO_PROVISION=true required to run provision engine
 *   - A staging launch report must exist
 *   - Staging status must be "success" (or "partial" with ALLOW_PARTIAL_STAGING_PROMOTION=true)
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { LaunchStatus, StagingProof } from "./types.js";

// ─── Staging proof ────────────────────────────────────────────────────────────

export async function readLatestStagingProof(reportsDir: string): Promise<StagingProof> {
  if (!existsSync(reportsDir)) {
    return { found: false, status: null, timestamp: null, path: null, agentName: null };
  }

  const files = (await readdir(reportsDir))
    .filter((f) => f.startsWith("staging-launch-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (files.length === 0) {
    return { found: false, status: null, timestamp: null, path: null, agentName: null };
  }

  const latest = files[0]!;
  const latestPath = path.join(reportsDir, latest);

  try {
    const content = await readFile(latestPath, "utf8");
    const data = JSON.parse(content) as {
      launchStatus?: string;
      timestamp?: string;
      agentName?: string;
    };
    return {
      found: true,
      status: (data.launchStatus ?? null) as LaunchStatus | null,
      timestamp: data.timestamp ?? null,
      path: latestPath,
      agentName: data.agentName ?? null,
    };
  } catch {
    return { found: true, status: null, timestamp: null, path: latestPath, agentName: null };
  }
}

// ─── Promotion gate check ─────────────────────────────────────────────────────

export interface PromotionGateResult {
  allowed: boolean;
  missingGates: string[];
  stagingProof: StagingProof;
  blockedReason: string | null;
}

export async function checkProductionPromotionGates(
  env: Record<string, string | undefined>,
  reportsDir: string
): Promise<PromotionGateResult> {
  const missingGates: string[] = [];

  // 1. Global production promotion gate
  if (env["ALLOW_PRODUCTION_PROMOTION"] !== "true") {
    missingGates.push("ALLOW_PRODUCTION_PROMOTION");
  }

  // 2. Explicit production deploy confirmation
  if (env["CONFIRM_PRODUCTION_DEPLOY"] !== "true") {
    missingGates.push("CONFIRM_PRODUCTION_DEPLOY");
  }

  // 3. Auto provision gate
  if (env["ALLOW_AUTO_PROVISION"] !== "true") {
    missingGates.push("ALLOW_AUTO_PROVISION");
  }

  if (missingGates.length > 0) {
    const stagingProof = await readLatestStagingProof(reportsDir);
    return {
      allowed: false,
      missingGates,
      stagingProof,
      blockedReason: `Missing gates: ${missingGates.join(", ")}`,
    };
  }

  // 4. Verify staging proof
  const stagingProof = await readLatestStagingProof(reportsDir);

  if (!stagingProof.found) {
    return {
      allowed: false,
      missingGates: [],
      stagingProof,
      blockedReason:
        "No staging launch report found. Run 'npm run launch:staging' first.",
    };
  }

  if (!stagingProof.status) {
    return {
      allowed: false,
      missingGates: [],
      stagingProof,
      blockedReason: "Staging launch report is invalid or unreadable.",
    };
  }

  const isGreen = stagingProof.status === "success";
  const isPartial = stagingProof.status === "partial";
  const allowPartial = env["ALLOW_PARTIAL_STAGING_PROMOTION"] === "true";

  if (!isGreen && !(isPartial && allowPartial)) {
    return {
      allowed: false,
      missingGates: [],
      stagingProof,
      blockedReason:
        isPartial
          ? `Staging status is 'partial'. Set ALLOW_PARTIAL_STAGING_PROMOTION=true to override.`
          : `Staging status is '${stagingProof.status}' — must be 'success' before promoting to production.`,
    };
  }

  return { allowed: true, missingGates: [], stagingProof, blockedReason: null };
}
