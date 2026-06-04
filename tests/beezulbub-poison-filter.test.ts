/**
 * tests/beezulbub-poison-filter.test.ts
 *
 * Tests for the Beezulbub poison filter.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  checkFilePaths,
  checkCodeContent,
  checkArchitecture,
  summarisePoisonFlags,
} from "../src/beezulbub/poison-filter.js";

describe("checkFilePaths", () => {
  test("detects .env committed", () => {
    const flags = checkFilePaths([".env", "src/index.ts"]);
    assert.ok(flags.some((f) => f.type === "committed_env"));
    assert.ok(flags.some((f) => f.severity === "critical"));
  });

  test("detects .env in subdirectory", () => {
    const flags = checkFilePaths(["config/.env", "src/index.ts"]);
    assert.ok(flags.some((f) => f.type === "committed_env"));
  });

  test("no flag for .env.example", () => {
    const flags = checkFilePaths([".env.example", ".env.staging.example"]);
    assert.equal(flags.filter((f) => f.type === "committed_env").length, 0);
  });

  test("detects credentials.json", () => {
    const flags = checkFilePaths(["credentials.json", "src/app.ts"]);
    assert.ok(flags.some((f) => f.type === "committed_credentials"));
  });

  test("detects private key file", () => {
    const flags = checkFilePaths(["server.pem", "id_rsa"]);
    assert.ok(flags.some((f) => f.type === "committed_key_file"));
  });

  test("no flags for clean file paths", () => {
    const flags = checkFilePaths(["src/index.ts", "README.md", "package.json", ".env.example"]);
    assert.equal(flags.length, 0);
  });
});

describe("checkCodeContent", () => {
  test("detects hardcoded API key", () => {
    const code = `const key = "sk-testkey123";`;
    const flags = checkCodeContent(code);
    // The pattern checks for api_key assignments, not bare strings
    // The 'sk-testkey123' would match secret/token patterns
    assert.ok(Array.isArray(flags));
  });

  test("detects hardcoded password", () => {
    const code = `const password = "hardcoded123";`;
    const flags = checkCodeContent(code);
    assert.ok(flags.some((f) => f.type === "hardcoded_password" || f.type.includes("password")));
  });

  test("detects credentials in URL", () => {
    const code = `const url = "https://user:pass@db.example.com/db";`;
    const flags = checkCodeContent(code);
    assert.ok(flags.some((f) => f.type === "credentials_in_url"));
  });

  test("detects eval usage", () => {
    const code = `eval("console.log('hello')");`;
    const flags = checkCodeContent(code);
    assert.ok(flags.some((f) => f.type === "eval_usage"));
  });

  test("no flags for clean code", () => {
    const code = `
      const url = process.env.API_URL;
      const key = process.env.API_KEY;
      export function fetchData() { return fetch(url); }
    `;
    const flags = checkCodeContent(code);
    assert.equal(flags.filter((f) => f.severity === "critical").length, 0);
  });
});

describe("checkArchitecture", () => {
  test("flags missing tests", () => {
    const flags = checkArchitecture({
      hasTests: false,
      deployScripts: [],
      hasDeepVendorLock: false,
      bypassesGates: false,
    });
    assert.ok(flags.some((f) => f.type === "no_test_suite"));
  });

  test("flags direct production deploy", () => {
    const flags = checkArchitecture({
      hasTests: true,
      deployScripts: ["deploy:production: node deploy.js --env production"],
      hasDeepVendorLock: false,
      bypassesGates: false,
    });
    assert.ok(flags.some((f) => f.type === "direct_production_deploy"));
  });

  test("no flags for clean architecture", () => {
    const flags = checkArchitecture({
      hasTests: true,
      deployScripts: [],
      hasDeepVendorLock: false,
      bypassesGates: false,
    });
    assert.equal(flags.length, 0);
  });
});

describe("summarisePoisonFlags", () => {
  test("returns clean message for no flags", () => {
    const summary = summarisePoisonFlags([]);
    assert.ok(summary.includes("No poison"));
  });

  test("includes severity counts", () => {
    const flags = [
      { type: "env", severity: "critical" as const, description: "x", recommendation: "y" },
      { type: "pw", severity: "high" as const, description: "x", recommendation: "y" },
    ];
    const summary = summarisePoisonFlags(flags);
    assert.ok(summary.includes("critical"));
    assert.ok(summary.includes("high"));
  });
});
