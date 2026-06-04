/**
 * src/beezulbub/pack-registry.ts
 *
 * Registry for generated pack skeletons.
 * Reads from each packs/<name>/pack.manifest.json file.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackListEntry, PackManifest } from "./pack-types.js";

export async function listPacks(
  packsDir: string
): Promise<PackListEntry[]> {
  if (!existsSync(packsDir)) return [];

  const entries: PackListEntry[] = [];
  const packDirs = await readdir(packsDir, { withFileTypes: true });

  for (const dir of packDirs) {
    if (!dir.isDirectory()) continue;
    const manifestPath = path.join(packsDir, dir.name, "pack.manifest.json");
    if (!existsSync(manifestPath)) continue;

    try {
      const raw = await readFile(manifestPath, "utf8");
      const manifest = JSON.parse(raw) as PackManifest;
      entries.push({
        packName: manifest.packName,
        version: manifest.packVersion,
        status: manifest.status,
        capabilities: manifest.capabilities,
        verdict: manifest.source.verdict,
        score: manifest.source.scoreOverall,
        createdAt: manifest.createdAt,
        packPath: path.join(packsDir, dir.name),
      });
    } catch { /* skip corrupt manifests */ }
  }

  // Sort by score descending
  return entries.sort((a, b) => b.score - a.score);
}

export function formatPackList(entries: PackListEntry[]): string {
  if (entries.length === 0) {
    return [
      `# Beezulbub Pack Registry`,
      ``,
      `No packs generated yet.`,
      ``,
      `Run 'npm run beezulbub:pack-plan' to plan a pack,`,
      `then 'npm run beezulbub:pack-generate -- --capability=<name> --from-latest --approve-devour'`,
      `to generate the first pack skeleton.`,
      ``,
    ].join("\n") + "\n";
  }

  const lines = [
    `# Beezulbub Pack Registry`,
    ``,
    `${entries.length} pack(s) found.`,
    ``,
  ];

  for (const entry of entries) {
    lines.push(`## ${entry.packName}`);
    lines.push(`Version: ${entry.version}`);
    lines.push(`Status: ${entry.status}`);
    lines.push(`Capabilities: ${entry.capabilities.join(", ")}`);
    lines.push(`Source verdict: ${entry.verdict} (${entry.score}/10)`);
    lines.push(`Created: ${entry.createdAt.slice(0, 10)}`);
    lines.push(`Path: ${entry.packPath}`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}
