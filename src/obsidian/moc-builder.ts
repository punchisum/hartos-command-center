/**
 * src/obsidian/moc-builder.ts — Live Organism P11: PURE builder for vault Maps-of-Content (MOCs).
 *
 * Turns the vault into a navigable lobby instead of a starburst dump: a Home MOC + per-area maps
 * (Command Center, Research Dossiers, Capability Scout, System Health/Wolverine, Agent Factory, Ops,
 * Fitness, Doctrine). Each MOC is an ADDITIVE, gated ObsidianNoteProposal — Hart approves + the
 * writer is armed before any file lands. Nothing is deleted; raw notes are never rewritten.
 *
 * PURE: no fs/clock (now injected). A host may pass a vault index ({folder: [{title, relPath}]}) to
 * produce linked MOCs; absent the index, MOCs reference their folder generically (still useful).
 */

import type { ObsidianNoteProposal } from "./obsidian-types.js";

export interface VaultNoteRef {
  title: string;
  relPath: string;
}
/** folder (vault-relative) → its notes, supplied by a host that scanned the vault. */
export type VaultIndex = Record<string, VaultNoteRef[]>;

export interface MocSpec {
  title: string;
  /** The area folder this map covers (relative to the vault). */
  folder: string;
  purpose: string;
  tags: string[];
}

/** The standard HartOS maps. Home is the lobby; the rest map one area each. */
export const STANDARD_MOCS: MocSpec[] = [
  { title: "Home", folder: "", purpose: "The vault lobby — start here. Links to every area map.", tags: ["hartos", "moc", "home"] },
  { title: "Command Center MOC", folder: "Cockpit", purpose: "The cockpit + command surface: routing, proposals, mutation spine.", tags: ["hartos", "moc", "command"] },
  { title: "Research Dossiers MOC", folder: "HartOS/Research Dossiers", purpose: "Deep-research dossiers (cited, confidence-banded).", tags: ["hartos", "moc", "research"] },
  { title: "Capability Scout MOC", folder: "HartOS/Capability Scout", purpose: "Beezulbub OSS capability scouts (what to absorb).", tags: ["hartos", "moc", "beezulbub"] },
  { title: "System Health MOC", folder: "HartOS/Wolverine Audits", purpose: "Wolverine audits + Prophet forecasts — the immune + foresight record.", tags: ["hartos", "moc", "wolverine", "health"] },
  { title: "Agent Factory MOC", folder: "Agents & Factory", purpose: "Agent specs, officiation, simulation, the factory pipeline.", tags: ["hartos", "moc", "factory"] },
  { title: "Ops MOC", folder: "Ops Agent", purpose: "Ops/business execution notes + ClickUp context.", tags: ["hartos", "moc", "ops"] },
  { title: "Fitness MOC", folder: "Fitness Agent", purpose: "Training / recovery / nutrition notes.", tags: ["hartos", "moc", "fitness"] },
  { title: "Doctrine MOC", folder: "Vision & Doctrine", purpose: "The constitution: vision, doctrine, design principles.", tags: ["hartos", "moc", "doctrine"] },
];

function linkList(notes: VaultNoteRef[] | undefined, folder: string): string[] {
  if (notes && notes.length) {
    return notes.slice(0, 50).map((n) => `- [[${n.title}]]`);
  }
  return [folder ? `- _Notes live in \`${folder}/\` — links appear here once the vault index is supplied._` : "- _Top-level area maps below._"];
}

export function buildMocProposal(spec: MocSpec, now: string, index?: VaultIndex): ObsidianNoteProposal {
  const day = now.slice(0, 10);
  const isHome = spec.title === "Home";
  const bodyLines = [`# ${spec.title}`, "", `> ${spec.purpose}`, ""];

  if (isHome) {
    bodyLines.push("## Area maps", "");
    for (const m of STANDARD_MOCS) {
      if (m.title === "Home") continue;
      bodyLines.push(`- [[${m.title}]] — ${m.purpose}`);
    }
  } else {
    bodyLines.push(`## Notes`, "", ...linkList(index?.[spec.folder], spec.folder));
  }
  bodyLines.push("", `_Map of Content · maintained by HartOS · updated ${day}. Additive only — no note is rewritten or deleted._`);

  return {
    title: spec.title,
    folder: "HartOS/Maps",
    noteType: "moc",
    tags: spec.tags,
    body: bodyLines.join("\n"),
    sources: [],
    confidence: "high",
    reason: `Vault navigability: a Map of Content for ${isHome ? "the whole vault" : spec.folder}.`,
    reviewBy: null,
    relatedAgents: ["Obsidian"],
    relatedProposals: [],
    createdAt: now,
  };
}

/** All standard MOC proposals (Home + per-area). Additive + gated. */
export function buildStandardMocs(now: string, index?: VaultIndex): ObsidianNoteProposal[] {
  return STANDARD_MOCS.map((m) => buildMocProposal(m, now, index));
}

export interface VaultHygieneReport {
  mocCount: number;
  foldersCovered: string[];
  /** Folders in the index with no MOC (a gap to consider later). */
  uncoveredFolders: string[];
  note: string;
}

/** A read-only vault hygiene summary (no mutation): which areas have maps, which don't. */
export function vaultHygiene(index: VaultIndex = {}): VaultHygieneReport {
  const covered = STANDARD_MOCS.filter((m) => m.folder).map((m) => m.folder);
  const indexFolders = Object.keys(index);
  const uncovered = indexFolders.filter((f) => !covered.includes(f));
  return {
    mocCount: STANDARD_MOCS.length,
    foldersCovered: covered,
    uncoveredFolders: uncovered,
    note: `${STANDARD_MOCS.length} standard map(s); ${covered.length} area(s) covered${uncovered.length ? `; ${uncovered.length} indexed folder(s) without a map` : ""}. Additive only.`,
  };
}
