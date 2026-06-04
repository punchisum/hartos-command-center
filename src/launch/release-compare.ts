/**
 * src/launch/release-compare.ts
 *
 * Compare two launch reports to detect changes between releases.
 * No mutations, no secrets.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ReleaseComparison, ReleaseChange, LaunchStatus } from "./types.js";

interface SafeLaunchSummary {
  timestamp: string;
  launchStatus: LaunchStatus;
  stepSummary: Array<{ id: string; status: string; manualRequired?: boolean }>;
  smokeResult: string;
  missingGates: string[];
  manualRequiredSteps: string[];
}

async function readLaunchSummary(filePath: string): Promise<SafeLaunchSummary | null> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content) as SafeLaunchSummary;
  } catch {
    return null;
  }
}

export async function readTwoLatestReports(
  reportsDir: string,
  prefix: string = "staging-launch-"
): Promise<{ current: SafeLaunchSummary | null; baseline: SafeLaunchSummary | null; currentPath: string | null; baselinePath: string | null }> {
  if (!existsSync(reportsDir)) {
    return { current: null, baseline: null, currentPath: null, baselinePath: null };
  }

  const files = (await readdir(reportsDir))
    .filter((f) => f.startsWith(prefix) && f.endsWith(".json"))
    .sort()
    .reverse();

  const currentPath = files[0] ? path.join(reportsDir, files[0]) : null;
  const baselinePath = files[1] ? path.join(reportsDir, files[1]) : null;

  const current = currentPath ? await readLaunchSummary(currentPath) : null;
  const baseline = baselinePath ? await readLaunchSummary(baselinePath) : null;

  return { current, baseline, currentPath, baselinePath };
}

export async function compareReleases(
  reportsDir: string,
  prefix?: string
): Promise<ReleaseComparison> {
  const { current, baseline, currentPath, baselinePath } = await readTwoLatestReports(reportsDir, prefix);
  const changes: ReleaseChange[] = [];

  if (!current) {
    return {
      baseline: null,
      current: null,
      changes: [],
      summary: "No launch reports found to compare. Run launch:staging first.",
    };
  }

  if (!baseline) {
    return {
      baseline: null,
      current: {
        timestamp: current.timestamp,
        status: current.launchStatus,
        path: currentPath!,
      },
      changes: [],
      summary: `Only one report found. Current: ${current.launchStatus} (${current.timestamp?.slice(0, 10) ?? "?"})`,
    };
  }

  // Compare statuses
  if (baseline.launchStatus !== current.launchStatus) {
    changes.push({
      type: "status_changed",
      description: `Launch status: ${baseline.launchStatus} → ${current.launchStatus}`,
    });
  }

  // Compare smoke results
  if (baseline.smokeResult !== current.smokeResult) {
    changes.push({
      type: "smoke_changed",
      description: `Smoke: ${baseline.smokeResult} → ${current.smokeResult}`,
    });
  }

  // Find newly manual_required steps
  const baselineManual = new Set(baseline.manualRequiredSteps ?? []);
  const currentManual = new Set(current.manualRequiredSteps ?? []);

  for (const step of currentManual) {
    if (!baselineManual.has(step)) {
      changes.push({ type: "new_manual_required", description: `New manual step: ${step}` });
    }
  }
  for (const step of baselineManual) {
    if (!currentManual.has(step)) {
      changes.push({ type: "resolved_manual_required", description: `Resolved manual step: ${step}` });
    }
  }

  const summary =
    changes.length === 0
      ? `No significant changes between releases. Status: ${current.launchStatus}`
      : `${changes.length} change(s) detected. Current: ${current.launchStatus}`;

  return {
    baseline: { timestamp: baseline.timestamp, status: baseline.launchStatus, path: baselinePath! },
    current: { timestamp: current.timestamp, status: current.launchStatus, path: currentPath! },
    changes,
    summary,
  };
}

export function formatReleaseComparison(comparison: ReleaseComparison): string {
  const lines = [
    `# Release Comparison`,
    ``,
    `Generated: ${new Date().toISOString()}`,
    ``,
  ];

  if (!comparison.current) {
    lines.push(comparison.summary);
    return lines.join("\n") + "\n";
  }

  lines.push(`## Reports`);
  if (comparison.baseline) {
    lines.push(`Baseline: ${comparison.baseline.status} (${comparison.baseline.timestamp?.slice(0, 19)})`);
  } else {
    lines.push(`Baseline: (none — first release)`);
  }
  lines.push(`Current:  ${comparison.current.status} (${comparison.current.timestamp?.slice(0, 19)})`);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(comparison.summary);
  lines.push(``);

  if (comparison.changes.length > 0) {
    lines.push(`## Changes`);
    for (const change of comparison.changes) {
      const icon = change.type === "resolved_manual_required" ? "✓" : "▲";
      lines.push(`${icon} ${change.description}`);
    }
    lines.push(``);
  }

  return lines.join("\n") + "\n";
}
