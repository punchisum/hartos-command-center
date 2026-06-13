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
import { isSelfModArmed } from "../src/doctrine/amendment-gate.js";

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

describe("Amendment §6 — self-mod is fail-closed by default", () => {
  it("self-mod arms ONLY behind the full AND of three conditions", () => {
    assert.equal(isSelfModArmed({ amendmentApproved: false, classFlagArmed: false, killSwitchOn: false }), false);
    assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: false, killSwitchOn: false }), false);
    assert.equal(isSelfModArmed({ amendmentApproved: false, classFlagArmed: true, killSwitchOn: false }), false);
    assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: false }), true);
  });

  it("the kill-switch dominates the amendment", () => {
    assert.equal(isSelfModArmed({ amendmentApproved: true, classFlagArmed: true, killSwitchOn: true }), false);
  });

  it("the doctrine carries a self-modification clause", () => {
    const clause = DOCTRINE.find((c) => c.id === "self-modification");
    assert.ok(clause, "expected a 'self-modification' clause in the doctrine");
    assert.ok(clause!.rule && clause!.enforcedBy, "the self-modification clause must be complete");
  });

  it("the human-approval floor records the auto-apply carve-out", () => {
    const human = DOCTRINE.find((c) => c.id === "human-approval");
    assert.ok(human, "expected the human-approval clause");
    assert.match(human!.rule, /Amendment §6|auto-apply|self-mod/i);
  });

  it("the path-(a) Worker fence still holds (invariant gate clean)", () => {
    assert.deepEqual(checkDoctrineInvariants(), []);
  });
});
