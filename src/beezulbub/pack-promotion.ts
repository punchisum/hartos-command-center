/**
 * src/beezulbub/pack-promotion.ts
 *
 * Pack promotion — gate-guarded lifecycle state transitions.
 *
 * Rules:
 *   - Cannot promote without env gate + CLI approval.
 *   - Cannot promote to `verified` unless pack-verify passes.
 *   - Cannot promote to `available` unless verified + provenance + not skeleton-only.
 *   - REJECT_* verdict packs cannot be promoted.
 *   - REFERENCE_ONLY packs cannot become `available`.
 */

import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackManifest, PackStatus } from "./pack-types.js";
import { canPromoteTo } from "./pack-lifecycle.js";
import { verifyPack } from "./pack-verifier.js";
import { loadLedger, hasProvenance } from "./provenance-ledger.js";
import { updateCapabilityStatus, loadRegistry } from "./capability-registry.js";

const REJECT_VERDICTS = new Set(["REJECT_POISON", "REJECT_LICENSE", "REJECT_STALE", "REJECT_LOW_VALUE"]);

export type PromoteTarget = "verified" | "available";

export interface PromoteOptions {
  packPath: string;
  targetStatus: PromoteTarget;
  approvePromote: boolean;
  allowPackPromote: boolean;
  ledgerPath?: string;
  registryPath?: string;
  cwd?: string;
}

export type PromoteStatus =
  | "promoted"
  | "blocked_missing_approval"
  | "blocked_bad_verdict"
  | "blocked_verification_failed"
  | "blocked_no_provenance"
  | "blocked_not_skeleton_only"
  | "blocked_invalid_transition"
  | "failed";

export interface PromoteResult {
  status: PromoteStatus;
  packName: string;
  fromStatus: PackStatus;
  toStatus: PromoteTarget | null;
  message: string;
}

export async function promotepack(options: PromoteOptions): Promise<PromoteResult> {
  const { packPath, targetStatus, approvePromote, allowPackPromote, ledgerPath, registryPath, cwd = process.cwd() } = options;

  // 1. Gate check
  if (!approvePromote || !allowPackPromote) {
    const missing: string[] = [];
    if (!approvePromote) missing.push("--approve-promote CLI flag");
    if (!allowPackPromote) missing.push("BEEZULBUB_ALLOW_PACK_PROMOTE=true");
    return {
      status: "blocked_missing_approval",
      packName: path.basename(packPath),
      fromStatus: "skeleton",
      toStatus: null,
      message: `Promotion blocked. Missing: ${missing.join(", ")}`,
    };
  }

  // 2. Load manifest
  const manifestPath = path.join(packPath, "pack.manifest.json");
  if (!existsSync(manifestPath)) {
    return { status: "failed", packName: path.basename(packPath), fromStatus: "skeleton", toStatus: null, message: "pack.manifest.json not found" };
  }

  let manifest: PackManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackManifest;
  } catch {
    return { status: "failed", packName: path.basename(packPath), fromStatus: "skeleton", toStatus: null, message: "Failed to parse manifest" };
  }

  const packName = manifest.packName;
  const currentStatus = manifest.status as PackStatus;

  // 3. Check verdict
  if (REJECT_VERDICTS.has(manifest.source.verdict)) {
    return { status: "blocked_bad_verdict", packName, fromStatus: currentStatus, toStatus: null, message: `Cannot promote ${manifest.source.verdict} verdict pack` };
  }
  if (manifest.status === "reference_only" && targetStatus === "available") {
    return { status: "blocked_bad_verdict", packName, fromStatus: currentStatus, toStatus: null, message: "REFERENCE_ONLY packs cannot become available" };
  }

  // 4. Check lifecycle transition
  const transition = canPromoteTo(currentStatus, targetStatus);
  if (!transition.allowed) {
    return { status: "blocked_invalid_transition", packName, fromStatus: currentStatus, toStatus: null, message: transition.reason };
  }

  // 5. For `verified`: run verification
  if (targetStatus === "verified") {
    const verifyResult = await verifyPack(
      packPath,
      ledgerPath,
      cwd
    );
    if (verifyResult.status !== "passed") {
      return {
        status: "blocked_verification_failed",
        packName,
        fromStatus: currentStatus,
        toStatus: null,
        message: `Verification failed (${verifyResult.failedCount} checks failed). Fix before promoting.`,
      };
    }
  }

  // 6. For `available`: check additional requirements
  if (targetStatus === "available") {
    if (currentStatus === "skeleton") {
      return { status: "blocked_not_skeleton_only", packName, fromStatus: currentStatus, toStatus: null, message: "Cannot promote skeleton to available — implement first" };
    }
    if (ledgerPath) {
      const ledger = await loadLedger(path.resolve(cwd, ledgerPath));
      const hasProv = manifest.capabilities.some((cap) => hasProvenance(ledger, cap));
      if (!hasProv) {
        return { status: "blocked_no_provenance", packName, fromStatus: currentStatus, toStatus: null, message: "No provenance recorded — cannot promote to available" };
      }
    }
  }

  // 7. Update manifest status
  manifest.status = targetStatus;
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // 8. Update capability registry
  if (registryPath) {
    const resolvedRegistry = path.resolve(cwd, registryPath);
    for (const capId of manifest.capabilities) {
      await updateCapabilityStatus(resolvedRegistry, capId, targetStatus as Parameters<typeof updateCapabilityStatus>[2]);
    }
  }

  return {
    status: "promoted",
    packName,
    fromStatus: currentStatus,
    toStatus: targetStatus,
    message: `Pack promoted: ${currentStatus} → ${targetStatus}`,
  };
}
