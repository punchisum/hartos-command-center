/**
 * tests/beezulbub-pack-safety.test.ts
 *
 * Tests for the pack safety scanner.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";
import {
  scanPackContent,
  redactSecrets,
  formatSafetyIssues,
} from "../src/beezulbub/pack-safety.js";

describe("scanPackContent — clean files", () => {
  test("passes for clean pack content", () => {
    const files = {
      "pack.manifest.json": JSON.stringify({ packName: "test", status: "skeleton" }),
      "README.md": "# Test Pack\n\nThis is a clean pack.\n",
      "adaptation-plan.md": "## Absorb\n\n- UI patterns\n",
    };
    const result = scanPackContent(files);
    assert.equal(result.passed, true);
    assert.equal(result.issues.length, 0);
  });

  test("passes for component stubs", () => {
    const files = {
      "components/README.md": "# Components\n\nStubs go here.\n",
      "tests/pack.contract.test.ts":
        "import { test } from 'node:test';\ntest('placeholder', () => {});\n",
    };
    const result = scanPackContent(files);
    assert.equal(result.passed, true);
  });
});

describe("scanPackContent — forbidden files", () => {
  test("flags committed .env", () => {
    const files = { ".env": "API_KEY=abc123" };
    const result = scanPackContent(files);
    assert.ok(result.issues.some((i) => i.type === "forbidden_file"));
  });

  test("flags package-lock.json", () => {
    const files = { "package-lock.json": '{"lockfileVersion": 3}' };
    const result = scanPackContent(files);
    assert.ok(result.issues.some((i) => i.type === "forbidden_file"));
  });

  test("committed .env makes scan fail", () => {
    const files = { ".env": "SECRET=abc" };
    const result = scanPackContent(files);
    assert.equal(result.passed, false);
  });
});

describe("scanPackContent — secret detection", () => {
  test("detects secret pattern at runtime (built via string concat)", () => {
    // Use concat to avoid triggering factory secret scanner on this file
    const prefix = "sk";
    const secret = `${prefix}-${"a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"}`;
    const files = { "README.md": `Token: ${secret}` };
    const result = scanPackContent(files);
    assert.ok(result.issues.some((i) => i.type === "secret_detected"));
    assert.equal(result.passed, false);
  });
});

describe("redactSecrets", () => {
  test("redacts secret-like patterns", () => {
    const prefix = "sk";
    const input = `API key: ${prefix}-${"abcdefghijklmnopqrstuvwxyz012345"}`;
    const redacted = redactSecrets(input);
    assert.ok(redacted.includes("[REDACTED]"));
    assert.ok(!redacted.includes(`${prefix}-`));
  });

  test("leaves clean content unchanged", () => {
    const clean = "# Pack README\n\nStatus: skeleton\n";
    const redacted = redactSecrets(clean);
    assert.equal(redacted, clean);
  });
});

describe("formatSafetyIssues", () => {
  test("returns clean message for no issues", () => {
    const formatted = formatSafetyIssues([]);
    assert.ok(formatted.includes("No issues"));
  });

  test("includes issue descriptions", () => {
    const issues = [
      {
        type: "secret_detected",
        severity: "critical" as const,
        file: "README.md",
        description: "Secret detected",
        action: "Redact it",
      },
    ];
    const formatted = formatSafetyIssues(issues);
    assert.ok(formatted.includes("CRITICAL") || formatted.includes("critical"));
    assert.ok(formatted.includes("secret_detected"));
  });
});
