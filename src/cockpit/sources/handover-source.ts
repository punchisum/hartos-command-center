/**
 * src/cockpit/sources/handover-source.ts
 *
 * Phase 13A — read-only handover / source-file parser. Reads a single local
 * handover file (configured per agent) and extracts `key: value` pairs plus a
 * short freshness signal (file mtime). Read-only; secret-looking values dropped.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { parseKeyValues } from "./local-report-source.js";

export interface HandoverHit {
  relativePath: string;
  lastUpdated: string;
  keyValues: Record<string, string>;
  /** First non-empty content line, for a human summary. */
  headline: string | null;
}

/** Read + parse a handover file. Returns null when absent/unreadable. */
export async function readHandover(cwd: string, relPath: string | undefined): Promise<HandoverHit | null> {
  if (!relPath) return null;
  const full = path.isAbsolute(relPath) ? relPath : path.join(cwd, relPath);
  if (!existsSync(full)) return null;
  let content = "";
  let mtimeMs = 0;
  try {
    content = await readFile(full, "utf8");
    mtimeMs = (await stat(full)).mtimeMs;
  } catch {
    return null;
  }
  const headline = content.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? null;
  return {
    relativePath: path.isAbsolute(relPath) ? path.basename(relPath) : relPath,
    lastUpdated: new Date(mtimeMs).toISOString(),
    keyValues: parseKeyValues(content),
    headline,
  };
}
