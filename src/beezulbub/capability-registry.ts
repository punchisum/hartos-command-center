/**
 * src/beezulbub/capability-registry.ts
 *
 * Capability registry — tracks all known capabilities and their lifecycle status.
 * Stored at: capabilities/capability-registry.json
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { CapabilityStatus } from "./pack-lifecycle.js";
import type { PackManifest } from "./pack-types.js";

const DEFAULT_REGISTRY_PATH = "capabilities/capability-registry.json";

// ─── Registry entry shape ─────────────────────────────────────────────────────

export interface CapabilityEntry {
  capabilityId: string;
  name: string;
  status: CapabilityStatus;
  sourceDigestId?: string;
  packPath?: string;
  currentPackVersion?: string;
  verdict?: string;
  scoreOverall?: number;
  license?: string | null;
  riskLevel?: "low" | "medium" | "high";
  lastVerifiedAt?: string | null;
  usedByAgents: string[];
  updatedAt: string;
}

export interface CapabilityRegistry {
  capabilities: Record<string, CapabilityEntry>;
  updatedAt: string;
}

// ─── Registry I/O ─────────────────────────────────────────────────────────────

export async function loadRegistry(
  registryPath: string
): Promise<CapabilityRegistry> {
  if (!existsSync(registryPath)) {
    return { capabilities: {}, updatedAt: new Date().toISOString() };
  }
  try {
    const raw = await readFile(registryPath, "utf8");
    return JSON.parse(raw) as CapabilityRegistry;
  } catch {
    return { capabilities: {}, updatedAt: new Date().toISOString() };
  }
}

export async function saveRegistry(
  registryPath: string,
  registry: CapabilityRegistry
): Promise<void> {
  await mkdir(path.dirname(registryPath), { recursive: true });
  registry.updatedAt = new Date().toISOString();
  await writeFile(registryPath, JSON.stringify(registry, null, 2) + "\n", "utf8");
}

// ─── Registry operations ──────────────────────────────────────────────────────

/** Register or update a capability after pack generation */
export async function registerPackGenerated(
  registryPath: string,
  manifest: PackManifest,
  packPath: string
): Promise<void> {
  const registry = await loadRegistry(registryPath);

  for (const capId of manifest.capabilities) {
    const existing = registry.capabilities[capId];
    registry.capabilities[capId] = {
      capabilityId: capId,
      name: formatCapabilityName(capId),
      status: "pack_skeleton_created",
      sourceDigestId: manifest.source.digestId,
      packPath,
      currentPackVersion: manifest.packVersion,
      verdict: manifest.source.verdict,
      scoreOverall: manifest.source.scoreOverall,
      license: manifest.source.license,
      riskLevel: computeRiskLevel(manifest.source.scoreOverall),
      lastVerifiedAt: existing?.lastVerifiedAt ?? null,
      usedByAgents: existing?.usedByAgents ?? [],
      updatedAt: new Date().toISOString(),
    };
  }

  await saveRegistry(registryPath, registry);
}

/** Update a capability status (e.g., after implement or promote) */
export async function updateCapabilityStatus(
  registryPath: string,
  capabilityId: string,
  status: CapabilityStatus,
  extra?: Partial<CapabilityEntry>
): Promise<void> {
  const registry = await loadRegistry(registryPath);
  const existing = registry.capabilities[capabilityId] ?? {
    capabilityId,
    name: formatCapabilityName(capabilityId),
    status: "missing",
    usedByAgents: [],
    updatedAt: new Date().toISOString(),
  };
  registry.capabilities[capabilityId] = {
    ...existing,
    ...extra,
    capabilityId,
    status,
    updatedAt: new Date().toISOString(),
  };
  await saveRegistry(registryPath, registry);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCapabilityName(id: string): string {
  return id
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function computeRiskLevel(score?: number): "low" | "medium" | "high" {
  if (!score) return "medium";
  if (score >= 7) return "low";
  if (score >= 4) return "medium";
  return "high";
}

// ─── Display ──────────────────────────────────────────────────────────────────

export function formatCapabilityList(registry: CapabilityRegistry): string {
  const entries = Object.values(registry.capabilities);

  if (entries.length === 0) {
    return [
      `# Beezulbub Capability Registry`,
      ``,
      `No capabilities registered yet.`,
      ``,
      `Run 'npm run beezulbub:pack-generate' to register a capability.`,
      ``,
    ].join("\n") + "\n";
  }

  const lines = [
    `# Beezulbub Capability Registry`,
    ``,
    `${entries.length} capability/capabilities registered.`,
    `Updated: ${registry.updatedAt}`,
    ``,
  ];

  for (const entry of entries.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId))) {
    lines.push(`## ${entry.capabilityId}`);
    lines.push(`Status: ${entry.status}`);
    lines.push(`Name: ${entry.name}`);
    if (entry.verdict) lines.push(`Verdict: ${entry.verdict} (${entry.scoreOverall ?? "??"}/10)`);
    if (entry.license) lines.push(`License: ${entry.license}`);
    if (entry.packPath) lines.push(`Pack: ${entry.packPath}`);
    if (entry.lastVerifiedAt) lines.push(`Last verified: ${entry.lastVerifiedAt}`);
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}
