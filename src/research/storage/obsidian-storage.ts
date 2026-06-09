/**
 * src/research/storage/obsidian-storage.ts — the Obsidian-vault StorageAdapter writer.
 *
 * An Obsidian vault is just a local folder of markdown notes, so this writer REUSES the
 * local-folder core (`runStorageWriteCore`) wholesale and only layers the vault's
 * conventions on top. It is the same doctrine as ./local-folder-storage.ts — GATED
 * (its own default-OFF flag `ALLOW_STORAGE_OBSIDIAN` + the kill-switch, enforced by the one
 * `runExecutionAdapter`), dry-run-able, read-before-write/idempotent, path-safe, secret-safe,
 * and reversible (correction note). The injected `StorageFs` seam is identical (fake in tests,
 * `node:fs/promises` live via `createNodeStorageFs`).
 *
 * The ONLY differences from the local-folder writer (kept minimal + documented):
 *   1. The artifact path is forced to a `.md` extension (Obsidian notes are markdown).
 *   2. Optional YAML frontmatter is prepended (e.g. tags, created date, source) — names/paths
 *      only; the secret-scan in the core still applies to the full rendered note.
 * Path-safety, approval/target-type guard (targetType="obsidian"), read-before-write, and the
 * idempotency/overwrite rules are unchanged — they live in the shared core.
 */

import type {
  StorageAdapter,
  StorageWriteIntent,
  StorageTarget,
} from "../storage-adapter.js";
import type { ExecutionOutcome } from "../../execution/execution-adapter.js";
import {
  runStorageWriteCore,
  supportsTargetFor,
  type StorageFs,
  type LocalFolderWriteDeps,
} from "./local-folder-storage.js";

/** Per-action allowlist flag — absent by default, so Obsidian-vault writes are OFF until enabled. */
export const STORAGE_OBSIDIAN_FLAG = "ALLOW_STORAGE_OBSIDIAN";

/** Optional Obsidian frontmatter fields (names/paths only — never secrets). */
export interface ObsidianFrontmatter {
  /** Obsidian tags (rendered as a YAML list under `tags:`). */
  tags?: string[];
  /** ISO created date. */
  created?: string;
  /** Free-form source reference (a url id / repo path / RPC name — never a token). */
  source?: string;
  /** Any extra scalar fields, rendered as `key: value`. */
  [key: string]: string | string[] | undefined;
}

export interface ObsidianWriteDeps {
  intent: StorageWriteIntent;
  /** The note body (markdown). The full rendered note (frontmatter + body) is secret-scanned. */
  content: string;
  /** Injected filesystem seam (fake in tests, node:fs/promises live). */
  fs: StorageFs;
  /** Opt-in overwrite of an existing note with DIFFERENT content. Default false ⇒ REFUSE. */
  overwrite?: boolean;
  /** Optional YAML frontmatter to prepend (Obsidian convention). */
  frontmatter?: ObsidianFrontmatter;
}

/** Force a `.md` extension on the artifact path (Obsidian notes are markdown). */
export function withMdExtension(artifactPath: string): string {
  return /\.md$/i.test(artifactPath) ? artifactPath : `${artifactPath}.md`;
}

/** Render YAML frontmatter as an Obsidian `--- ... ---` block, or "" when there is none. */
export function renderFrontmatter(fm: ObsidianFrontmatter | undefined): string {
  if (!fm) return "";
  const lines: string[] = [];
  for (const [key, value] of Object.entries(fm)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${item}`);
    } else {
      lines.push(`${key}: ${value}`);
    }
  }
  if (lines.length === 0) return "";
  return `---\n${lines.join("\n")}\n---\n\n`;
}

/**
 * Apply Obsidian conventions to deps, then hand off to the SHARED local-folder core with
 * targetType="obsidian". The note gets a `.md` path and (optional) frontmatter; everything
 * else — path-safety, approval guard, secret-scan, read-before-write, idempotency,
 * correction note — is the identical core. The allowlist/kill-switch gate is enforced by
 * `runExecutionAdapter` (the one runner), not here.
 */
function toCoreDeps(deps: ObsidianWriteDeps): LocalFolderWriteDeps {
  const artifactPath = withMdExtension(deps.intent.artifactPath);
  const note = `${renderFrontmatter(deps.frontmatter)}${deps.content}`;
  return {
    intent: { ...deps.intent, artifactPath },
    content: note,
    fs: deps.fs,
    overwrite: deps.overwrite,
  };
}

export const obsidianStorageAdapter: StorageAdapter = {
  id: "storage-obsidian",
  allowlistFlag: STORAGE_OBSIDIAN_FLAG,
  targetType: "obsidian",

  supportsTarget(target: StorageTarget): boolean {
    return supportsTargetFor(target, "obsidian");
  },

  async dryRun(deps: unknown): Promise<ExecutionOutcome> {
    return runStorageWriteCore(toCoreDeps(deps as ObsidianWriteDeps), "obsidian", "dryRun");
  },

  async execute(deps: unknown): Promise<ExecutionOutcome> {
    return runStorageWriteCore(toCoreDeps(deps as ObsidianWriteDeps), "obsidian", "execute");
  },
};
