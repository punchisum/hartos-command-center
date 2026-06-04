/**
 * src/beezulbub/candidate-compare.ts
 *
 * Compare candidates from existing batch/digest reports.
 * No network required. Reads from local report files.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { ComparisonReport, BeezulbubVerdict } from "./types.js";

interface ScoreRecord {
  name: string;
  verdict: BeezulbubVerdict;
  overall: number;
  licenseSafety: number;
  securityRisk: number;
  hartosCompatibility: number;
  capabilityValue: number;
  poisonCount: number;
}

interface ScoreJson {
  repoName?: string;
  verdict?: string;
  score?: {
    overall?: number;
    licenseSafety?: number;
    securityRisk?: number;
    hartosCompatibility?: number;
    capabilityValue?: number;
  };
  poisonFlagCount?: number;
}

export async function compareFromReports(reportsDir: string): Promise<ComparisonReport> {
  const timestamp = new Date().toISOString();

  if (!existsSync(reportsDir)) {
    return emptyComparison(timestamp, "No reports directory found");
  }

  // Read all score JSON files
  const files = await readdir(reportsDir);
  const scoreFiles = files
    .filter((f) => f.startsWith("score-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (scoreFiles.length === 0) {
    return emptyComparison(timestamp, "No score files found. Run beezulbub:digest first.");
  }

  const candidates: ScoreRecord[] = [];

  for (const file of scoreFiles) {
    try {
      const raw = await readFile(path.join(reportsDir, file), "utf8");
      const data = JSON.parse(raw) as ScoreJson;
      if (!data.repoName || !data.verdict) continue;
      candidates.push({
        name: data.repoName,
        verdict: data.verdict as BeezulbubVerdict,
        overall: data.score?.overall ?? 0,
        licenseSafety: data.score?.licenseSafety ?? 0,
        securityRisk: data.score?.securityRisk ?? 10,
        hartosCompatibility: data.score?.hartosCompatibility ?? 0,
        capabilityValue: data.score?.capabilityValue ?? 0,
        poisonCount: data.poisonFlagCount ?? 0,
      });
    } catch { /* skip corrupt files */ }
  }

  // Also check for batch JSON files
  const batchFiles = files
    .filter((f) => f.startsWith("batch-digest-") && f.endsWith(".json"))
    .sort()
    .reverse();

  for (const file of batchFiles.slice(0, 1)) {
    try {
      const raw = await readFile(path.join(reportsDir, file), "utf8");
      const data = JSON.parse(raw) as {
        ranking?: Array<{ name: string; verdict: string; overall: number }>;
      };
      if (data.ranking) {
        for (const r of data.ranking) {
          if (!candidates.some((c) => c.name === r.name)) {
            candidates.push({
              name: r.name,
              verdict: r.verdict as BeezulbubVerdict,
              overall: r.overall,
              licenseSafety: 5,
              securityRisk: 5,
              hartosCompatibility: 5,
              capabilityValue: 5,
              poisonCount: 0,
            });
          }
        }
      }
    } catch { /* skip */ }
  }

  if (candidates.length === 0) {
    return emptyComparison(timestamp, "No valid score data found in reports.");
  }

  // Deduplicate by name (keep most recent = highest position in sorted array)
  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.name)) return false;
    seen.add(c.name);
    return true;
  });

  // Find winners in each category
  const topCandidate = unique.sort((a, b) => b.overall - a.overall)[0]?.name ?? null;
  const bestCapabilityMatch = unique.sort((a, b) => b.capabilityValue - a.capabilityValue)[0]?.name ?? null;
  const cleanestLicense = unique.sort((a, b) => b.licenseSafety - a.licenseSafety)[0]?.name ?? null;
  const lowestPoison = unique.sort((a, b) => a.poisonCount - b.poisonCount)[0]?.name ?? null;
  const bestHartosCompat = unique.sort((a, b) => b.hartosCompatibility - a.hartosCompatibility)[0]?.name ?? null;

  const top = unique.find((c) => c.name === topCandidate);
  const recommendedVerdict = top?.verdict ?? "REFERENCE_ONLY";

  const devourCount = unique.filter((c) =>
    c.verdict === "DEVOUR" || c.verdict === "PARTIAL_DEVOUR"
  ).length;
  const rejectCount = unique.filter((c) => c.verdict.startsWith("REJECT")).length;

  const nextAction =
    devourCount > 0
      ? `Proceed with ${topCandidate} — ${recommendedVerdict}. ` +
        `Extract ${top?.capabilityValue ?? 0}/10 value capabilities to HartOS packs (Phase 11C).`
      : `No devourable candidates found. Scout more candidates or adjust target.`;

  const summary =
    `Compared ${unique.length} candidate(s). ` +
    `Best: ${topCandidate ?? "none"} (${top?.overall ?? 0}/10). ` +
    `${devourCount} devourable, ${rejectCount} rejected.`;

  return {
    timestamp,
    source: reportsDir,
    candidates: unique,
    topCandidate,
    bestCapabilityMatch,
    cleanestLicense,
    lowestPoison,
    bestHartosCompat,
    recommendedVerdict,
    nextAction,
    summary,
  };
}

function emptyComparison(timestamp: string, message: string): ComparisonReport {
  return {
    timestamp,
    source: "",
    candidates: [],
    topCandidate: null,
    bestCapabilityMatch: null,
    cleanestLicense: null,
    lowestPoison: null,
    bestHartosCompat: null,
    recommendedVerdict: "REFERENCE_ONLY",
    nextAction: message,
    summary: message,
  };
}

export function formatComparisonReport(report: ComparisonReport): string {
  const lines = [
    `# Beezulbub Comparison Report`,
    ``,
    `Timestamp: ${report.timestamp}`,
    `Candidates: ${report.candidates.length}`,
    ``,
    `## Rankings`,
    ``,
  ];

  const sorted = [...report.candidates].sort((a, b) => b.overall - a.overall);
  for (const [i, c] of sorted.entries()) {
    const tags: string[] = [];
    if (c.name === report.topCandidate) tags.push("🏆 TOP");
    if (c.name === report.cleanestLicense) tags.push("✓ LICENSE");
    if (c.name === report.lowestPoison) tags.push("✓ CLEAN");
    if (c.name === report.bestHartosCompat) tags.push("✓ HARTOS");
    lines.push(
      `${i + 1}. **${c.name}** — ${c.verdict} (${c.overall}/10) ${tags.join(" ")}`
    );
  }

  lines.push(``);
  lines.push(`## Category winners`);
  lines.push(``);
  if (report.topCandidate) lines.push(`🏆 Best overall:      ${report.topCandidate}`);
  if (report.bestCapabilityMatch) lines.push(`🎯 Best capability:   ${report.bestCapabilityMatch}`);
  if (report.cleanestLicense) lines.push(`✓ Cleanest license:  ${report.cleanestLicense}`);
  if (report.lowestPoison) lines.push(`✓ Least poison:      ${report.lowestPoison}`);
  if (report.bestHartosCompat) lines.push(`✓ Best HartOS compat: ${report.bestHartosCompat}`);

  lines.push(``);
  lines.push(`## Recommendation`);
  lines.push(``);
  lines.push(`Verdict: **${report.recommendedVerdict}**`);
  lines.push(report.nextAction);
  lines.push(``);
  lines.push(`## Summary`);
  lines.push(``);
  lines.push(report.summary);
  lines.push(``);
  lines.push(`---`);
  lines.push(`Generated by HartOS Beezulbub Phase 11B`);

  return lines.join("\n") + "\n";
}
