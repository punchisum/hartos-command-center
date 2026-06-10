/**
 * src/cockpit/sources/local-report-source.ts
 *
 * Phase 13A — read-only local report source. Finds the most recent report file
 * under a set of directories, reads it, and extracts simple `key: value` lines.
 * Read-only: it never writes. It returns the file's mtime as `lastUpdated` so a
 * freshness verdict can be computed. Secret-looking values are dropped.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";

export interface ReportHit {
  /** Path relative to cwd. */
  relativePath: string;
  /** mtime (ISO) — used for freshness. */
  lastUpdated: string;
  content: string;
}

const SECRET_RX = [
  /sk-[A-Za-z0-9_-]{20,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function looksSecret(value: string): boolean {
  return SECRET_RX.some((rx) => rx.test(value));
}

/**
 * Find the most recent report (by mtime) under `dirs` whose name matches
 * `matcher` (if given). Returns null when none exist. Read-only.
 */
export async function findLatestReport(
  cwd: string,
  dirs: string[],
  matcher?: RegExp
): Promise<ReportHit | null> {
  let best: { full: string; rel: string; mtimeMs: number } | null = null;
  for (const dir of dirs) {
    const full = path.join(cwd, dir);
    if (!existsSync(full)) continue;
    let entries: string[];
    try {
      entries = await readdir(full);
    } catch {
      continue;
    }
    const candidates = entries.filter(
      (file) => (file.endsWith(".md") || file.endsWith(".json")) && (!matcher || matcher.test(file)),
    );
    // Stat candidates CONCURRENTLY. This was a serial await-in-loop — O(files) sequential syscalls,
    // which with thousands of report files dominated cockpit:snapshot latency. Same selection: the
    // most recent by mtime, first-seen wins ties (candidate order preserved + strict `>`).
    const stats = await Promise.all(
      candidates.map(async (file) => {
        const filePath = path.join(full, file);
        try {
          const s = await stat(filePath);
          return { full: filePath, rel: `${dir}/${file}`, mtimeMs: s.mtimeMs };
        } catch {
          return null; // ignore unreadable entries
        }
      }),
    );
    for (const c of stats) {
      if (c && (!best || c.mtimeMs > best.mtimeMs)) best = c;
    }
  }
  if (!best) return null;
  let content = "";
  try {
    content = await readFile(best.full, "utf8");
  } catch {
    return null;
  }
  return { relativePath: best.rel, lastUpdated: new Date(best.mtimeMs).toISOString(), content };
}

/**
 * Extract simple `key: value` / `- key: value` pairs from markdown/plain text.
 * Keys are lower-cased and trimmed. Secret-looking values are dropped.
 */
export function parseKeyValues(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.replace(/^[-*\s]+/, "").trim();
    const idx = line.indexOf(":");
    if (idx <= 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!key || !value || key.length > 60) continue;
    if (looksSecret(value)) continue;
    if (!(key in out)) out[key] = value;
  }
  return out;
}

/** Pull the first present value among candidate keys (case-insensitive). */
export function pick(kv: Record<string, string>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = kv[k.toLowerCase()];
    if (v != null && v !== "") return v;
  }
  return undefined;
}
