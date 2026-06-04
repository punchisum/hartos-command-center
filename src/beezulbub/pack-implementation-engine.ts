/**
 * src/beezulbub/pack-implementation-engine.ts
 *
 * Phase 11E: Turn a skeleton pack into HartOS-native implementation stubs.
 *
 * Rules:
 *   - Requires BEEZULBUB_ALLOW_PACK_IMPLEMENT=true
 *   - Requires --approve-implementation CLI flag
 *   - Pack must be in skeleton status
 *   - Verdict must be DEVOUR or PARTIAL_DEVOUR
 *   - Provenance must exist
 *   - Does NOT copy third-party source code
 *   - All generated stubs are HartOS-native
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackManifest } from "./pack-types.js";
import type { ImplementOptions, ImplementResult } from "./pack-implementation-types.js";
import { getImplementationFiles } from "./pack-implementation-templates.js";
import { scanPackContent } from "./pack-safety.js";
import { loadLedger, hasProvenance } from "./provenance-ledger.js";
import { updateCapabilityStatus, loadRegistry } from "./capability-registry.js";

const DEVOURABLE_VERDICTS = new Set(["DEVOUR", "PARTIAL_DEVOUR"]);

export async function implementPack(options: ImplementOptions): Promise<ImplementResult> {
  const {
    packPath,
    approveImplementation,
    allowPackImplement,
    ledgerPath,
    registryPath,
    cwd = process.cwd(),
  } = options;

  const packName = path.basename(packPath);

  // 1. Gate check
  if (!approveImplementation || !allowPackImplement) {
    const missing: string[] = [];
    if (!approveImplementation) missing.push("--approve-implementation");
    if (!allowPackImplement) missing.push("BEEZULBUB_ALLOW_PACK_IMPLEMENT=true");
    return {
      status: "blocked_missing_approval",
      packName,
      packPath,
      message: `Implementation blocked. Missing: ${missing.join(", ")}`,
      filesGenerated: [],
      capabilityType: "unknown",
    };
  }

  // 2. Load manifest
  const manifestPath = path.join(packPath, "pack.manifest.json");
  if (!existsSync(manifestPath)) {
    return { status: "failed", packName, packPath, message: "pack.manifest.json not found", filesGenerated: [], capabilityType: "unknown" };
  }

  let manifest: PackManifest;
  try {
    manifest = JSON.parse(await readFile(manifestPath, "utf8")) as PackManifest;
  } catch {
    return { status: "failed", packName, packPath, message: "Failed to parse manifest", filesGenerated: [], capabilityType: "unknown" };
  }

  // 3. Status check — must be skeleton
  if (manifest.status !== "skeleton") {
    return {
      status: "blocked_bad_status",
      packName,
      packPath,
      message: `Pack status is "${manifest.status}" — can only implement packs with status="skeleton"`,
      filesGenerated: [],
      capabilityType: "unknown",
    };
  }

  // 4. Verdict check
  if (!DEVOURABLE_VERDICTS.has(manifest.source.verdict)) {
    return {
      status: "blocked_bad_verdict",
      packName,
      packPath,
      message: `Verdict is "${manifest.source.verdict}" — can only implement DEVOUR or PARTIAL_DEVOUR packs`,
      filesGenerated: [],
      capabilityType: "unknown",
    };
  }

  // 5. Provenance check
  if (ledgerPath) {
    const ledger = await loadLedger(path.resolve(cwd, ledgerPath));
    const hasProv = manifest.capabilities.some((cap) => hasProvenance(ledger, cap));
    if (!hasProv) {
      return {
        status: "blocked_no_provenance",
        packName,
        packPath,
        message: "No provenance found for this pack. Run beezulbub:pack-generate first.",
        filesGenerated: [],
        capabilityType: "unknown",
      };
    }
  }

  // 6. Get implementation files for capability type
  const { files, capabilityType } = getImplementationFiles(manifest.packName, manifest.capabilities);

  // 7. Safety scan
  const fileMap: Record<string, string> = {};
  for (const f of files) {
    fileMap[f.relativePath] = f.content;
  }
  const safety = scanPackContent(fileMap);
  if (!safety.passed) {
    return {
      status: "failed",
      packName,
      packPath,
      message: `Implementation safety scan failed: ${safety.summary}`,
      filesGenerated: [],
      capabilityType,
    };
  }

  // 8. Write files
  const generated: string[] = [];
  for (const file of files) {
    const fullPath = path.join(packPath, file.relativePath);
    await mkdir(path.dirname(fullPath), { recursive: true });
    await writeFile(fullPath, file.content, "utf8");
    generated.push(file.relativePath);
  }

  // 9. Update manifest status → implementation_draft
  manifest.status = "implementation_draft";
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");

  // 10. Update capability registry
  if (registryPath) {
    const resolvedRegistry = path.resolve(cwd, registryPath);
    for (const capId of manifest.capabilities) {
      await updateCapabilityStatus(resolvedRegistry, capId, "implementation_draft").catch(() => {});
    }
  }

  return {
    status: "implemented",
    packName,
    packPath,
    message: `Pack implementation draft generated (${generated.length} files). Status: skeleton → implementation_draft`,
    filesGenerated: generated,
    capabilityType,
  };
}
