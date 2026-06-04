/**
 * tests/beezulbub-pack-implementation-templates.test.ts
 *
 * Tests for pack implementation templates (Phase 11E).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { getImplementationFiles } from "../src/beezulbub/pack-implementation-templates.js";

const HARTOS_HEADER_MARKER = "HartOS-native scaffold.";
const NO_COPY_MARKER = "Third-party source code was not copied.";
const REVIEW_MARKER = "Implementation must be completed under HartOS review.";

function assertAllFilesHaveHartOSHeader(files: ReturnType<typeof getImplementationFiles>["files"]): void {
  for (const f of files) {
    if (!f.relativePath.endsWith(".ts")) continue;
    assert.ok(f.content.includes(HARTOS_HEADER_MARKER), `File ${f.relativePath} missing HartOS-native scaffold marker`);
    assert.ok(f.content.includes(NO_COPY_MARKER), `File ${f.relativePath} missing "Third-party source code was not copied" marker`);
    assert.ok(f.content.includes(REVIEW_MARKER), `File ${f.relativePath} missing HartOS review marker`);
  }
}

function assertNoSecrets(files: ReturnType<typeof getImplementationFiles>["files"]): void {
  const secretPattern = /sk-[A-Za-z0-9_-]{20,}/;
  const jwtPattern = /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/;
  for (const f of files) {
    assert.ok(!secretPattern.test(f.content), `File ${f.relativePath} contains sk- secret pattern`);
    assert.ok(!jwtPattern.test(f.content), `File ${f.relativePath} contains JWT pattern`);
  }
}

describe("pack-implementation-templates", () => {
  describe("dashboard_layout", () => {
    it("routes correctly to dashboard_layout template", () => {
      const { capabilityType } = getImplementationFiles("dash-pack", ["dashboard_layout"]);
      assert.equal(capabilityType, "dashboard_layout");
    });

    it("generates required files", () => {
      const { files } = getImplementationFiles("dash-pack", ["dashboard_layout"]);
      assert.ok(files.length > 0);
      const paths = files.map((f) => f.relativePath);
      assert.ok(paths.some((p) => p.includes("components")));
      assert.ok(paths.some((p) => p.includes("tests")));
    });

    it("all .ts files include HartOS header", () => {
      const { files } = getImplementationFiles("dash-pack", ["dashboard_layout"]);
      assertAllFilesHaveHartOSHeader(files);
    });

    it("no secrets in generated files", () => {
      const { files } = getImplementationFiles("dash-pack", ["dashboard_layout"]);
      assertNoSecrets(files);
    });
  });

  describe("receipt_ocr", () => {
    it("routes correctly to receipt_ocr template", () => {
      const { capabilityType } = getImplementationFiles("ocr-pack", ["receipt_ocr"]);
      assert.equal(capabilityType, "receipt_ocr");
    });

    it("generates runtime files", () => {
      const { files } = getImplementationFiles("ocr-pack", ["receipt_ocr"]);
      const paths = files.map((f) => f.relativePath);
      assert.ok(paths.some((p) => p.includes("runtime")));
    });

    it("all .ts files include HartOS header", () => {
      const { files } = getImplementationFiles("ocr-pack", ["receipt_ocr"]);
      assertAllFilesHaveHartOSHeader(files);
    });

    it("no secrets in generated files", () => {
      const { files } = getImplementationFiles("ocr-pack", ["receipt_ocr"]);
      assertNoSecrets(files);
    });
  });

  describe("agent_status_card", () => {
    it("routes correctly to agent_status_card template", () => {
      const { capabilityType } = getImplementationFiles("asc-pack", ["agent_status_card"]);
      assert.equal(capabilityType, "agent_status_card");
    });

    it("all .ts files include HartOS header", () => {
      const { files } = getImplementationFiles("asc-pack", ["agent_status_card"]);
      assertAllFilesHaveHartOSHeader(files);
    });
  });

  describe("generic fallback", () => {
    it("routes unknown capabilities to generic fallback", () => {
      const { capabilityType } = getImplementationFiles("unknown-pack", ["some_unknown_capability"]);
      assert.equal(capabilityType, "generic");
    });

    it("generates at least a capability boundary file", () => {
      const { files } = getImplementationFiles("unknown-pack", ["my_cap"]);
      const paths = files.map((f) => f.relativePath);
      assert.ok(paths.some((p) => p.includes("runtime")), "Generic should produce runtime files");
    });

    it("all .ts files include HartOS header", () => {
      const { files } = getImplementationFiles("unknown-pack", ["my_cap"]);
      assertAllFilesHaveHartOSHeader(files);
    });

    it("no secrets in generic files", () => {
      const { files } = getImplementationFiles("unknown-pack", ["my_cap"]);
      assertNoSecrets(files);
    });
  });

  describe("upgrade artifacts", () => {
    it("always generates a contract test file", () => {
      for (const cap of ["dashboard_layout", "receipt_ocr", "agent_status_card", "generic_cap"]) {
        const { files } = getImplementationFiles(`${cap}-pack`, [cap]);
        const hasTest = files.some((f) => f.relativePath.includes("pack.contract.test.ts"));
        assert.ok(hasTest, `${cap}: must include pack.contract.test.ts`);
      }
    });

    it("always generates a smoke plan", () => {
      for (const cap of ["dashboard_layout", "receipt_ocr", "agent_status_card", "generic_cap"]) {
        const { files } = getImplementationFiles(`${cap}-pack`, [cap]);
        const hasSmoke = files.some((f) => f.relativePath.includes("smoke-plan.md"));
        assert.ok(hasSmoke, `${cap}: must include smoke/smoke-plan.md`);
      }
    });
  });
});
