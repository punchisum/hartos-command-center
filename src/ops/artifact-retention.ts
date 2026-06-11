/**
 * src/ops/artifact-retention.ts — PURE retention planner for local run-artifact sprawl.
 *
 * HartOS commands write timestamped JSON run artifacts (cockpit-reports/, hartos-reports/,
 * cockpit-threads/, …). They are gitignored (never repo bloat) but grow unbounded on disk —
 * the 2026-06-06 audit counted ~800; the sprawl makes every directory listing, backup and
 * grep slower and buries the artifact that matters: the newest one.
 *
 * This module is the PURE half: given a directory inventory it plans which files to keep
 * (the newest N per directory) and which to prune. It never touches the filesystem — the
 * CLI wrapper (scripts/prune-artifacts.ts) gathers the inventory, prints the plan, and only
 * deletes under an explicit --apply flag (propose-don't-act: dry-run is the default).
 * Wolverine's sprawl detector reuses `planRetention` to rank the same fact read-only.
 */

/** One artifact file as inventoried by the caller (mtime in epoch ms). */
export interface ArtifactFile {
  name: string;
  mtimeMs: number;
  bytes: number;
}

/** One directory's inventory. */
export interface ArtifactDirInventory {
  dir: string;
  files: ArtifactFile[];
}

export interface DirRetentionPlan {
  dir: string;
  total: number;
  keep: ArtifactFile[];
  prune: ArtifactFile[];
  pruneBytes: number;
}

export interface RetentionPlan {
  keepPerDir: number;
  dirs: DirRetentionPlan[];
  totalFiles: number;
  totalPrune: number;
  totalPruneBytes: number;
}

/** The artifact directories HartOS writes run reports into (all gitignored). */
export const ARTIFACT_DIRS = [
  "cockpit-reports",
  "cockpit-threads",
  "cockpit-proposals",
  "hartos-reports",
  "cloudflare-cockpit-reports",
  "data-provision-reports",
  "runtime-provision-reports",
  "read-model-reports",
  "provision-reports",
  "launch-reports",
  "production-reports",
  "bootstrap-reports",
  "llm-reports",
  "agent-integration-reports",
  "research-reports",
  "beezulbub-reports",
  "reports",
] as const;

export const DEFAULT_KEEP_PER_DIR = 25;

/**
 * Plan retention: newest `keepPerDir` files per directory survive; the rest are prune
 * candidates. PURE + deterministic — ties on mtime break by name (descending) so the
 * same inventory always yields the same plan. Never deletes anything itself.
 */
export function planRetention(
  inventory: ArtifactDirInventory[],
  keepPerDir: number = DEFAULT_KEEP_PER_DIR,
): RetentionPlan {
  const keepN = Math.max(0, Math.floor(keepPerDir));
  const dirs: DirRetentionPlan[] = inventory.map(({ dir, files }) => {
    const sorted = [...files].sort(
      (a, b) => b.mtimeMs - a.mtimeMs || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0),
    );
    const keep = sorted.slice(0, keepN);
    const prune = sorted.slice(keepN);
    return {
      dir,
      total: files.length,
      keep,
      prune,
      pruneBytes: prune.reduce((sum, f) => sum + f.bytes, 0),
    };
  });
  return {
    keepPerDir: keepN,
    dirs,
    totalFiles: dirs.reduce((s, d) => s + d.total, 0),
    totalPrune: dirs.reduce((s, d) => s + d.prune.length, 0),
    totalPruneBytes: dirs.reduce((s, d) => s + d.pruneBytes, 0),
  };
}

/** Human-honest one-screen summary of a plan (counts + bytes, per dir + total). */
export function describeRetentionPlan(plan: RetentionPlan): string {
  const lines: string[] = [
    `Artifact retention plan — keep newest ${plan.keepPerDir} per directory.`,
    `${plan.totalFiles} file(s) inventoried; ${plan.totalPrune} prune candidate(s) (${formatBytes(plan.totalPruneBytes)}).`,
  ];
  for (const d of plan.dirs) {
    if (d.total === 0) continue;
    lines.push(
      `  ${d.dir}: ${d.total} file(s) → keep ${d.keep.length}, prune ${d.prune.length}` +
        (d.prune.length > 0 ? ` (${formatBytes(d.pruneBytes)})` : ""),
    );
  }
  return lines.join("\n");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
