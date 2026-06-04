/**
 * src/beezulbub/github-search.ts
 *
 * GitHub repository search via the GitHub REST API.
 * Injectable fetch for testing — no real network calls in tests.
 *
 * Security rules:
 *   - GITHUB_TOKEN is NEVER logged or included in output.
 *   - Authorization header is NEVER logged.
 *   - Only safe metadata is included in results.
 */

import type { GitHubRepoMetadata } from "./types.js";

// GitHub search API endpoint
const GITHUB_SEARCH_URL = "https://api.github.com/search/repositories";
const DEFAULT_LIMIT = 10;

/** Safe headers — token captured in closure, never returned or logged */
function makeHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

/** Build a GitHub search query for a capability target */
export function buildSearchQuery(target: string): string {
  // Map capability targets to search terms
  const SEARCH_TERMS: Record<string, string> = {
    dashboard_layout: "dashboard react tailwind",
    admin_table: "admin table react data-grid",
    receipt_ocr: "receipt ocr typescript",
    pdf_parser: "pdf parse typescript node",
    csv_export: "csv export react typescript",
    fitness_chart: "fitness chart react",
    timeline_viewer: "timeline viewer react",
    file_upload: "file upload react dropzone",
    agent_status_card: "agent status dashboard",
    launch_report_viewer: "launch report viewer",
    supabase_auth_ui: "supabase auth react",
    markdown_editor: "markdown editor react typescript",
    data_grid: "data grid react typescript",
    kanban_board: "kanban board react",
    notification_center: "notification center react typescript",
    audit_log_viewer: "audit log viewer react",
  };

  const terms = SEARCH_TERMS[target] ?? target.replace(/_/g, " ");
  return `${terms} language:TypeScript stars:>50 is:public`;
}

/** GitHub API repository item shape */
interface GitHubApiRepo {
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  language: string | null;
  license?: { spdx_id?: string; name?: string } | null;
  topics?: string[];
}

interface GitHubSearchResponse {
  total_count: number;
  items: GitHubApiRepo[];
}

/** Score a GitHub repo by relevance to the target capability */
function scoreRelevance(repo: GitHubApiRepo, target: string): number {
  let score = 5; // baseline

  const targetWords = target.toLowerCase().replace(/_/g, " ").split(" ");
  const nameLower = repo.name.toLowerCase();
  const descLower = (repo.description ?? "").toLowerCase();
  const topics = (repo.topics ?? []).map((t) => t.toLowerCase());

  for (const word of targetWords) {
    if (nameLower.includes(word)) score += 1;
    if (descLower.includes(word)) score += 0.5;
    if (topics.some((t) => t.includes(word))) score += 1;
  }

  // Stars boost (capped at 2 points)
  if (repo.stargazers_count > 1000) score += 2;
  else if (repo.stargazers_count > 100) score += 1;
  else if (repo.stargazers_count > 10) score += 0.5;

  // Recency bonus
  const pushedAt = new Date(repo.pushed_at);
  const monthsAgo = (Date.now() - pushedAt.getTime()) / (1000 * 60 * 60 * 24 * 30);
  if (monthsAgo < 3) score += 1;
  else if (monthsAgo > 24) score -= 1;

  return Math.min(10, Math.max(0, Math.round(score * 10) / 10));
}

function extractLicenseName(repo: GitHubApiRepo): string | null {
  if (!repo.license) return null;
  return repo.license.spdx_id ?? repo.license.name ?? null;
}

/** Search GitHub for repos matching a capability target */
export async function searchGitHub(options: {
  target: string;
  limit?: number;
  token?: string; // Never logged
  fetchImpl?: typeof fetch;
  allowNetwork?: boolean;
}): Promise<{ candidates: GitHubRepoMetadata[]; totalCount: number; error?: string }> {
  const {
    target,
    limit = DEFAULT_LIMIT,
    token,
    fetchImpl = fetch,
    allowNetwork = false,
  } = options;

  if (!allowNetwork) {
    return {
      candidates: [],
      totalCount: 0,
      error:
        "Live GitHub search requires BEEZULBUB_ALLOW_NETWORK=true. " +
        "Set it to enable live scouting.",
    };
  }

  const query = buildSearchQuery(target);
  const url = `${GITHUB_SEARCH_URL}?q=${encodeURIComponent(query)}&per_page=${limit}&sort=stars&order=desc`;

  try {
    const res = await fetchImpl(url, {
      method: "GET",
      headers: makeHeaders(token),
    });

    if (!res.ok) {
      if (res.status === 401) {
        return {
          candidates: [],
          totalCount: 0,
          error: "GitHub API auth failed (HTTP 401). Check GITHUB_TOKEN.",
        };
      }
      if (res.status === 403) {
        return {
          candidates: [],
          totalCount: 0,
          error: `GitHub API rate limit or forbidden (HTTP 403). ` +
            `Set GITHUB_TOKEN for higher rate limits.`,
        };
      }
      return {
        candidates: [],
        totalCount: 0,
        error: `GitHub API returned HTTP ${res.status}`,
      };
    }

    const data = (await res.json()) as GitHubSearchResponse;
    const candidates: GitHubRepoMetadata[] = data.items.map((repo) => ({
      name: repo.name,
      fullName: repo.full_name,
      htmlUrl: repo.html_url,
      description: repo.description,
      stars: repo.stargazers_count,
      forks: repo.forks_count,
      openIssues: repo.open_issues_count,
      pushedAt: repo.pushed_at,
      language: repo.language,
      license: extractLicenseName(repo),
      topics: repo.topics ?? [],
      relevanceScore: scoreRelevance(repo, target),
    }));

    // Sort by relevance score descending
    candidates.sort((a, b) => b.relevanceScore - a.relevanceScore);

    return { candidates, totalCount: data.total_count };
  } catch (err) {
    return {
      candidates: [],
      totalCount: 0,
      error: `GitHub search network error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
    };
  }
}
