/**
 * tests/code-build-parse.test.ts — the code-build generator's fenced-block parser.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseGeneratedFiles } from "../scripts/code-build.js";

describe("parseGeneratedFiles", () => {
  it("names files from a leading // file: line and strips it from content", () => {
    const text = "blah\n```ts\n// file: debounce.ts\nexport const x = 1;\n```\nmore";
    const files = parseGeneratedFiles(text);
    assert.equal(files.length, 1);
    assert.equal(files[0]!.path, "debounce.ts");
    assert.equal(files[0]!.content.trim(), "export const x = 1;");
  });

  it("falls back to generated-N.ts when unnamed, and skips empty blocks", () => {
    const text = "```ts\nexport const a = 1;\n```\n```ts\n\n```\n```typescript\n// file: b.ts\nexport const b = 2;\n```";
    const files = parseGeneratedFiles(text);
    assert.equal(files.length, 2);
    assert.equal(files[0]!.path, "generated-0.ts");
    assert.equal(files[1]!.path, "b.ts");
  });

  it("returns nothing when there are no code fences", () => {
    assert.equal(parseGeneratedFiles("just prose, no code").length, 0);
  });
});
