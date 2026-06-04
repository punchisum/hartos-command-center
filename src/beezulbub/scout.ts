/**
 * src/beezulbub/scout.ts
 *
 * Scout candidate repositories for a given capability target.
 *
 * Phase 11A: Fixture/local mode.
 * Phase 11B: Live GitHub search via runLiveScout().
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { BeezulbubScoutResult, ScoutCandidate, ScoutOptions } from "./types.js";
import { getCandidatesForTarget, isKnownTarget } from "./registry.js";
import { runLiveScout } from "./live-scout.js";

export async function scoutCandidates(
  options: ScoutOptions
): Promise<BeezulbubScoutResult> {
  const { target, candidatesPath, live = false, limit, githubToken, fetchImpl } = options;

  // Phase 11B: Live mode
  if (live) {
    const env: Record<string, string | undefined> = process.env as Record<string, string | undefined>;
    const allowNetwork = env["BEEZULBUB_ALLOW_NETWORK"] === "true";
    const token = githubToken ?? env["GITHUB_TOKEN"];
    return runLiveScout({ target, limit, allowNetwork, githubToken: token, fetchImpl });
  }
  const timestamp = new Date().toISOString();

  let candidates: ScoutCandidate[] = [];
  let mode: BeezulbubScoutResult["mode"] = "fixture";

  // 1. Load from provided candidates file if given
  if (candidatesPath && existsSync(candidatesPath)) {
    try {
      const raw = await readFile(candidatesPath, "utf8");
      const parsed = JSON.parse(raw) as ScoutCandidate[];
      candidates = parsed.filter(
        (c) => !target || c.targetCapability === target
      );
      mode = "fixture";
    } catch (err) {
      console.error(`Failed to load candidates file: ${err instanceof Error ? err.message : "unknown"}`);
    }
  }

  // 2. Fall back to built-in registry
  if (candidates.length === 0) {
    candidates = getCandidatesForTarget(target);
    mode = "fixture";
  }

  // 3. Sort by estimated value descending
  candidates = [...candidates].sort((a, b) => b.estimatedValue - a.estimatedValue);

  // Build recommendation
  const topCandidate = candidates[0];
  let recommendation: string;

  if (candidates.length === 0) {
    recommendation =
      `No built-in candidates for target "${target}". ` +
      `To scout live: provide a --candidates JSON file or use Phase 11B GitHub integration. ` +
      (isKnownTarget(target)
        ? `"${target}" is a known HartOS capability target.`
        : `"${target}" is not in the HartOS capability registry. Consider adding it.`);
  } else {
    recommendation =
      `Found ${candidates.length} candidate(s) for "${target}". ` +
      `Top pick: ${topCandidate!.name} (value: ${topCandidate!.estimatedValue}/10, risk: ${topCandidate!.staleRisk}). ` +
      `Next: run beezulbub:digest --repo=<local-path-to-${topCandidate!.name}>`;
  }

  return {
    target,
    candidates,
    timestamp,
    mode,
    recommendation,
  };
}

export function formatScoutResult(result: BeezulbubScoutResult): string {
  const lines = [
    `# Beezulbub Scout: ${result.target}`,
    ``,
    `Mode: ${result.mode}`,
    `Timestamp: ${result.timestamp}`,
    ``,
    `## Candidates (${result.candidates.length})`,
    ``,
  ];

  if (result.candidates.length === 0) {
    lines.push("No candidates found in built-in registry.");
    lines.push("");
    lines.push("Provide a --candidates JSON file or clone repos manually for digestion.");
  } else {
    for (const [i, c] of result.candidates.entries()) {
      lines.push(`### ${i + 1}. ${c.name}`);
      lines.push(`Value: ${c.estimatedValue}/10 | Stale risk: ${c.staleRisk}`);
      if (c.licenseGuess) lines.push(`License (guess): ${c.licenseGuess}`);
      if (c.sourceUrl) lines.push(`URL: ${c.sourceUrl}`);
      if (c.localPath) lines.push(`Local: ${c.localPath}`);
      lines.push(`Reason: ${c.reason}`);
      if (c.notes) lines.push(`Notes: ${c.notes}`);
      lines.push(``);
    }
  }

  lines.push(`## Recommendation`);
  lines.push(``);
  lines.push(result.recommendation);
  lines.push(``);

  if (result.mode === "fixture") {
    lines.push(`> Phase 11A: Scout uses built-in fixtures only.`);
    lines.push(`> Phase 11B will add live GitHub search integration.`);
    lines.push(`> To digest a candidate, clone it locally and run:`);
    lines.push(`>   npm run beezulbub:digest -- --repo=/path/to/clone`);
  }

  return lines.join("\n") + "\n";
}
