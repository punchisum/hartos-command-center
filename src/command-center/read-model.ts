/**
 * src/command-center/read-model.ts
 *
 * Reads LOCAL files/reports to populate each card's read model. It NEVER calls
 * the network and NEVER mutates anything. When a source directory or file is
 * absent, the card degrades safely to status="missing", confidence="low", and a
 * safe recommendation to run the relevant local report command.
 *
 * Pack usability rule (Phase 11D/11E governance preserved):
 *   - skeleton            → NOT usable
 *   - implementation_draft→ NOT usable (planning/draft only)
 *   - verified/available  → usable only WITH provenance
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import type {
  CardDefinition,
  CardReadModel,
  Confidence,
  ReadStatus,
} from "./command-center-types.js";
import { CARD_REGISTRY } from "./card-registry.js";

export interface ReadModelOptions {
  cwd?: string;
}

// ─── Pack usability ─────────────────────────────────────────────────────────

export type PackUsability = "usable" | "planning_only" | "not_usable";

export interface PackAssessment {
  name: string;
  status: string;
  hasProvenance: boolean;
  usability: PackUsability;
  reason: string;
}

/** Statuses that are explicitly NOT usable regardless of provenance. */
const NON_USABLE_STATUSES = new Set(["skeleton", "implementation_draft", "planning_only", "rejected"]);

export function classifyPackUsability(status: string, hasProvenance: boolean): { usability: PackUsability; reason: string } {
  if (status === "skeleton") {
    return { usability: "not_usable", reason: "Skeleton pack: structure only, no implementation." };
  }
  if (status === "implementation_draft") {
    return { usability: "planning_only", reason: "Implementation draft: NOT production-ready, requires review." };
  }
  if (NON_USABLE_STATUSES.has(status)) {
    return { usability: "not_usable", reason: `Status "${status}" is not usable.` };
  }
  if (status === "verified" || status === "available" || status === "promoted") {
    if (!hasProvenance) {
      return { usability: "not_usable", reason: `Status "${status}" but provenance is missing; cannot be trusted.` };
    }
    return { usability: "usable", reason: `Status "${status}" with provenance.` };
  }
  return { usability: "not_usable", reason: `Unknown status "${status}"; treated as not usable.` };
}

interface LedgerShape {
  entries?: Array<{ packName?: string }>;
}

async function loadProvenancePacks(cwd: string): Promise<Set<string>> {
  const ledgerPath = path.join(cwd, "capabilities", "provenance-ledger.json");
  if (!existsSync(ledgerPath)) return new Set();
  try {
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8")) as LedgerShape;
    const names = new Set<string>();
    for (const e of ledger.entries ?? []) {
      if (e.packName) names.add(e.packName);
    }
    return names;
  } catch {
    return new Set();
  }
}

/** Assess every pack under packs/. Degrades safely when packs/ is absent. */
export async function assessPacks(options: ReadModelOptions = {}): Promise<PackAssessment[]> {
  const cwd = options.cwd ?? process.cwd();
  const packsDir = path.join(cwd, "packs");
  if (!existsSync(packsDir)) return [];

  const provenancePacks = await loadProvenancePacks(cwd);
  const out: PackAssessment[] = [];

  let entries: string[];
  try {
    entries = await readdir(packsDir);
  } catch {
    return [];
  }

  for (const name of entries.sort()) {
    const manifestPath = path.join(packsDir, name, "pack.manifest.json");
    if (!existsSync(manifestPath)) continue;
    let status = "unknown";
    let packName = name;
    try {
      const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { status?: string; packName?: string };
      status = manifest.status ?? "unknown";
      packName = manifest.packName ?? name;
    } catch {
      status = "unknown";
    }
    const hasProvenance = provenancePacks.has(packName);
    const { usability, reason } = classifyPackUsability(status, hasProvenance);
    out.push({ name: packName, status, hasProvenance, usability, reason });
  }
  return out;
}

// ─── Source presence ──────────────────────────────────────────────────────────

interface SourcePresence {
  sourcePath: string;
  present: boolean;
  entryCount: number;
}

/** Resolve presence of a local source path (file, dir, or glob). Never throws. */
async function resolvePresence(cwd: string, sourcePath: string): Promise<SourcePresence> {
  // Glob like "packs/*/pack.manifest.json": check the dir before the wildcard.
  if (sourcePath.includes("*")) {
    const dir = path.join(cwd, sourcePath.slice(0, sourcePath.indexOf("*")));
    if (!existsSync(dir)) return { sourcePath, present: false, entryCount: 0 };
    try {
      const entries = await readdir(dir);
      return { sourcePath, present: entries.length > 0, entryCount: entries.length };
    } catch {
      return { sourcePath, present: false, entryCount: 0 };
    }
  }

  const resolved = path.join(cwd, sourcePath);
  if (!existsSync(resolved)) return { sourcePath, present: false, entryCount: 0 };

  // Directory source: count entries.
  if (sourcePath.endsWith("/")) {
    try {
      const entries = await readdir(resolved);
      return { sourcePath, present: entries.length > 0, entryCount: entries.length };
    } catch {
      return { sourcePath, present: false, entryCount: 0 };
    }
  }

  return { sourcePath, present: true, entryCount: 1 };
}

function recommendationFor(card: CardDefinition): string {
  switch (card.group) {
    case "orchestrator":
      return 'Run: npm run hartos:orchestrate -- --request="<your request>"';
    case "factory":
      if (card.id === "factory_bootstrap_status") return "Run: npm run bootstrap:verify";
      return "Run: npm run launch:verify";
    case "beezulbub":
      if (card.id === "beezulbub_conflict_report") return "Run: npm run beezulbub:pack-conflicts";
      return "Run: npm run beezulbub:capability-list";
    case "agents":
      return "Run: npm run hartos:handover";
    case "human_control":
    default:
      return "Run: npm run command-center:plan";
  }
}

/** Build the read model for a single card. Always succeeds (degrades safely). */
export async function readCard(card: CardDefinition, options: ReadModelOptions = {}): Promise<CardReadModel> {
  const cwd = options.cwd ?? process.cwd();

  // Derived/none cards have no offline source — they degrade to a recommendation.
  if (card.sourceType === "derived" || card.sourceType === "none" || card.sourcePaths.length === 0) {
    return {
      cardId: card.id,
      group: card.group,
      status: "missing",
      confidence: "low",
      presentSources: [],
      missingSources: [...card.sourcePaths],
      summary:
        card.sourceType === "none"
          ? "No offline data source for this card in Phase 11G (live reads are out of scope)."
          : "Derived card — computed from other cards once their sources exist.",
      safeRecommendation: recommendationFor(card),
    };
  }

  const presences = await Promise.all(card.sourcePaths.map((p) => resolvePresence(cwd, p)));
  const presentSources = presences.filter((p) => p.present).map((p) => p.sourcePath);
  const missingSources = presences.filter((p) => !p.present).map((p) => p.sourcePath);

  let status: ReadStatus;
  let confidence: Confidence;
  if (presentSources.length === 0) {
    status = "missing";
    confidence = "low";
  } else if (presentSources.length === card.sourcePaths.length) {
    status = "ok";
    confidence = "high";
  } else {
    status = "ok";
    confidence = "medium";
  }

  const summary =
    status === "missing"
      ? `No local data found for ${card.title}.`
      : `${card.title}: ${presentSources.length}/${card.sourcePaths.length} sources present.`;

  return {
    cardId: card.id,
    group: card.group,
    status,
    confidence,
    presentSources,
    missingSources,
    summary,
    safeRecommendation: status === "missing" ? recommendationFor(card) : "Up to date — view the latest report.",
  };
}

/** Build the read model for every card in the registry. */
export async function buildReadModel(options: ReadModelOptions = {}): Promise<CardReadModel[]> {
  return Promise.all(CARD_REGISTRY.map((card) => readCard(card, options)));
}

/** All source paths that were not found, across all cards (deduplicated). */
export function collectMissingSources(readModels: CardReadModel[]): string[] {
  const set = new Set<string>();
  for (const rm of readModels) for (const m of rm.missingSources) set.add(m);
  return [...set].sort();
}
