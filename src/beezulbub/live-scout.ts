/**
 * src/beezulbub/live-scout.ts
 *
 * Live GitHub scouting using the GitHub search API.
 * Injectable fetch boundary for testing — no real network in tests.
 *
 * Rules:
 *   - Requires BEEZULBUB_ALLOW_NETWORK=true to call GitHub API.
 *   - GITHUB_TOKEN is never logged.
 *   - Falls back to fixture mode gracefully if network unavailable.
 */

import type { BeezulbubScoutResult, ScoutCandidate, GitHubRepoMetadata } from "./types.js";
import { searchGitHub } from "./github-search.js";
import { getCandidatesForTarget } from "./registry.js";

function githubMetaToCandidate(
  meta: GitHubRepoMetadata,
  target: string
): ScoutCandidate {
  const monthsAgo = Math.floor(
    (Date.now() - new Date(meta.pushedAt).getTime()) / (1000 * 60 * 60 * 24 * 30)
  );
  const staleRisk: ScoutCandidate["staleRisk"] =
    monthsAgo > 24 ? "high" : monthsAgo > 12 ? "medium" : "low";

  return {
    name: meta.name,
    sourceUrl: meta.htmlUrl,
    targetCapability: target,
    reason: meta.description ?? `GitHub repo: ${meta.fullName}`,
    estimatedValue: meta.relevanceScore,
    licenseGuess: meta.license ?? undefined,
    staleRisk,
    notes:
      `Stars: ${meta.stars}, Forks: ${meta.forks}, ` +
      `Language: ${meta.language ?? "unknown"}, ` +
      `Pushed: ${meta.pushedAt.slice(0, 10)}`,
  };
}

export async function runLiveScout(options: {
  target: string;
  limit?: number;
  allowNetwork?: boolean;
  githubToken?: string; // Never logged
  fetchImpl?: typeof fetch;
}): Promise<BeezulbubScoutResult> {
  const { target, limit = 10, allowNetwork = false, githubToken, fetchImpl } = options;
  const timestamp = new Date().toISOString();

  if (!allowNetwork) {
    // Fall back to fixture mode with a clear note
    const fixtureCandidates = getCandidatesForTarget(target);
    return {
      target,
      candidates: fixtureCandidates,
      timestamp,
      mode: "fixture",
      recommendation:
        `Live GitHub search is disabled (BEEZULBUB_ALLOW_NETWORK not set). ` +
        `Showing ${fixtureCandidates.length} built-in fixture candidate(s). ` +
        `Set BEEZULBUB_ALLOW_NETWORK=true to enable live search.`,
    };
  }

  // Attempt live search
  const result = await searchGitHub({
    target,
    limit,
    token: githubToken,
    fetchImpl,
    allowNetwork,
  });

  if (result.error) {
    // Search failed — fall back to fixtures with explanation
    const fixtureCandidates = getCandidatesForTarget(target);
    return {
      target,
      candidates: fixtureCandidates,
      timestamp,
      mode: "fixture",
      recommendation:
        `Live search failed: ${result.error}. ` +
        `Falling back to ${fixtureCandidates.length} built-in fixture candidate(s).`,
    };
  }

  const candidates = result.candidates.map((meta) =>
    githubMetaToCandidate(meta, target)
  );

  const topCandidate = candidates[0];
  const recommendation =
    candidates.length === 0
      ? `No results found for "${target}" via live GitHub search.`
      : `Found ${result.totalCount} total results. Showing top ${candidates.length}. ` +
        `Top: ${topCandidate!.name} (value: ${topCandidate!.estimatedValue}/10). ` +
        `Next: clone and digest: npm run beezulbub:digest -- --repo=${topCandidate!.sourceUrl}`;

  return {
    target,
    candidates,
    timestamp,
    mode: "live",
    recommendation,
  };
}
