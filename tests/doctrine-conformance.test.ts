/**
 * tests/doctrine-conformance.test.ts — Phase 2.1.
 *
 * The CI gate that fails the build if anyone weakens the doctrine: execution enabled,
 * a mutation endpoint, executeProposal not failing closed, or a pg/DB driver reaching
 * the Worker's home (src/runtime). Reads the SOURCE tree statically for the pg guard.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DOCTRINE, DOCTRINE_VERSION, checkDoctrineInvariants, renderDoctrineMarkdown } from "../src/doctrine/doctrine.js";

// Compiled test lives at dist/tests/; the SOURCE tree is two levels up at <repo>/src.
const here = path.dirname(fileURLToPath(import.meta.url));
const runtimeDir = path.join(here, "..", "..", "src", "runtime");

const PG_PATTERN = /from\s+["']pg["']|require\(\s*["']pg["']\s*\)|new\s+Pool\(|supabase-proposal-db/;

describe("doctrine conformance (2.1)", () => {
  it("every runtime enforcement invariant holds (execution disabled, fail-closed, no mutation endpoints)", () => {
    assert.deepEqual(checkDoctrineInvariants(), []);
  });

  it("no pg / DB driver is reachable from the Worker's home (src/runtime is pg-free)", () => {
    assert.ok(existsSync(runtimeDir), `expected source runtime dir at ${runtimeDir}`);
    const offenders: string[] = [];
    for (const f of readdirSync(runtimeDir)) {
      if (!f.endsWith(".ts")) continue;
      if (PG_PATTERN.test(readFileSync(path.join(runtimeDir, f), "utf8"))) offenders.push(f);
    }
    assert.deepEqual(offenders, [], `runtime files must never import a DB driver — found in: ${offenders.join(", ")}`);
  });

  it("renders DOCTRINE.md from the code, covering all clauses (doc ← code)", () => {
    const md = renderDoctrineMarkdown();
    assert.match(md, new RegExp(`HartOS Doctrine ${DOCTRINE_VERSION}`));
    assert.ok(DOCTRINE.length >= 9, "doctrine should cover at least the 9 core clauses");
    for (const c of DOCTRINE) {
      assert.ok(c.id && c.title && c.rule && c.enforcedBy, `clause "${c.id}" is incomplete`);
      assert.ok(md.includes(c.title), `rendered doc missing clause: ${c.title}`);
      assert.ok(md.includes(c.enforcedBy), `rendered doc missing the enforcement note for: ${c.title}`);
    }
  });
});
