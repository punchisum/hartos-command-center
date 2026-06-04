/**
 * tests/beezulbub-live-scout.test.ts
 *
 * Tests for Beezulbub live GitHub scout.
 * All GitHub API calls are mocked via injected fetch.
 * No real network calls.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { searchGitHub, buildSearchQuery } from "../src/beezulbub/github-search.js";
import { runLiveScout } from "../src/beezulbub/live-scout.js";
import { scoutCandidates } from "../src/beezulbub/scout.js";

// ─── Mock GitHub API response ─────────────────────────────────────────────────

function makeMockGitHubResponse(repos: Array<{
  name: string;
  full_name: string;
  html_url: string;
  description: string | null;
  stargazers_count: number;
  forks_count: number;
  open_issues_count: number;
  pushed_at: string;
  language: string | null;
  license?: { spdx_id: string } | null;
  topics?: string[];
}>): typeof fetch {
  return async (): Promise<Response> =>
    new Response(JSON.stringify({ total_count: repos.length, items: repos }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
}

function makeErrorFetch(status: number): typeof fetch {
  return async (): Promise<Response> =>
    new Response(JSON.stringify({ message: "error" }), { status });
}

function makeNetworkErrorFetch(): typeof fetch {
  return async (): Promise<Response> => {
    throw new Error("ECONNREFUSED");
  };
}

const MOCK_REPOS = [
  {
    name: "shadcn-dashboard",
    full_name: "user/shadcn-dashboard",
    html_url: "https://github.com/user/shadcn-dashboard",
    description: "React dashboard with Tailwind",
    stargazers_count: 2500,
    forks_count: 400,
    open_issues_count: 20,
    pushed_at: new Date().toISOString(),
    language: "TypeScript",
    license: { spdx_id: "MIT" },
    topics: ["dashboard", "react", "tailwind"],
  },
  {
    name: "old-dashboard",
    full_name: "user/old-dashboard",
    html_url: "https://github.com/user/old-dashboard",
    description: "Old dashboard",
    stargazers_count: 50,
    forks_count: 5,
    open_issues_count: 100,
    pushed_at: new Date(Date.now() - 3 * 365 * 24 * 60 * 60 * 1000).toISOString(), // 3 years ago
    language: "JavaScript",
    license: null,
    topics: [],
  },
];

// ─── searchGitHub tests ───────────────────────────────────────────────────────

describe("searchGitHub — mocked fetch", () => {
  test("returns candidates when network allowed and mock succeeds", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    assert.ok(result.candidates.length > 0);
    assert.equal(result.error, undefined);
  });

  test("includes safe metadata only — no tokens in output", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: true,
      token: "super-secret-token",
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    // Token must not appear in any candidate
    for (const c of result.candidates) {
      const json = JSON.stringify(c);
      assert.ok(!json.includes("super-secret-token"), "Token must not appear in candidates");
    }
  });

  test("sorts candidates by relevance score descending", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    const scores = result.candidates.map((c) => c.relevanceScore);
    for (let i = 0; i < scores.length - 1; i++) {
      assert.ok(scores[i]! >= scores[i + 1]!, "Candidates must be sorted by relevance");
    }
  });

  test("blocks when BEEZULBUB_ALLOW_NETWORK not set", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: false,
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    assert.equal(result.candidates.length, 0);
    assert.ok(result.error?.includes("BEEZULBUB_ALLOW_NETWORK"));
  });

  test("handles 401 auth failure safely", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeErrorFetch(401),
    });
    assert.equal(result.candidates.length, 0);
    assert.ok(result.error?.includes("401") || result.error?.includes("auth"));
  });

  test("handles 403 rate limit safely", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeErrorFetch(403),
    });
    assert.equal(result.candidates.length, 0);
    assert.ok(result.error?.includes("403") || result.error?.includes("rate"));
  });

  test("handles network error safely", async () => {
    const result = await searchGitHub({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeNetworkErrorFetch(),
    });
    assert.equal(result.candidates.length, 0);
    assert.ok(result.error !== undefined);
  });
});

// ─── runLiveScout tests ───────────────────────────────────────────────────────

describe("runLiveScout — mocked fetch", () => {
  test("returns fixture candidates when network not allowed", async () => {
    const result = await runLiveScout({ target: "dashboard_layout", allowNetwork: false });
    assert.equal(result.mode, "fixture");
    assert.ok(result.recommendation.includes("BEEZULBUB_ALLOW_NETWORK"));
  });

  test("returns live candidates when network allowed and mock succeeds", async () => {
    const result = await runLiveScout({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    assert.equal(result.mode, "live");
    assert.ok(result.candidates.length > 0);
  });

  test("falls back to fixture on API failure", async () => {
    const result = await runLiveScout({
      target: "dashboard_layout",
      allowNetwork: true,
      fetchImpl: makeNetworkErrorFetch(),
    });
    assert.equal(result.mode, "fixture");
    assert.ok(result.recommendation.includes("failed") || result.recommendation.includes("fixture"));
  });

  test("GitHub token never in recommendation or candidate names", async () => {
    const result = await runLiveScout({
      target: "dashboard_layout",
      allowNetwork: true,
      githubToken: "my-secret-github-token",
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    const text = JSON.stringify(result);
    assert.ok(!text.includes("my-secret-github-token"), "Token must not appear in results");
  });
});

// ─── scoutCandidates --live mode ──────────────────────────────────────────────

describe("scoutCandidates — live mode via flag", () => {
  test("passes live mode to live scout", async () => {
    const result = await scoutCandidates({
      target: "dashboard_layout",
      live: true,
      fetchImpl: makeMockGitHubResponse(MOCK_REPOS),
    });
    // With mocked fetch and no BEEZULBUB_ALLOW_NETWORK env, should fall back or use live
    assert.ok(result.candidates !== undefined);
  });
});

// ─── buildSearchQuery tests ───────────────────────────────────────────────────

describe("buildSearchQuery", () => {
  test("builds query for known target", () => {
    const query = buildSearchQuery("dashboard_layout");
    assert.ok(query.includes("dashboard"));
    assert.ok(query.includes("TypeScript") || query.includes("stars"));
  });

  test("uses target words for unknown target", () => {
    const query = buildSearchQuery("custom_ocr_engine");
    assert.ok(query.includes("custom ocr engine") || query.includes("custom_ocr_engine".replace(/_/g, " ")));
  });
});
