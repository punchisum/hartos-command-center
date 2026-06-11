/**
 * tests/cockpit-synapse-v4.test.ts — the flag-gated V4 "Synapse" command home.
 *
 * With opts.v4 the Overview becomes the neural constellation + decisions-as-nodes; without it the
 * page stays V3 (covered by cockpit-hosted-page.test.ts). Either way the JS contract + the five
 * toggleable views + the shell invariants are preserved.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderHostedCockpitPage } from "../src/runtime/cloudflare-cockpit-page.js";

const now = "2026-06-11T08:00:00.000Z";

describe("cockpit V4 — Synapse home (flag-gated)", () => {
  const v4 = renderHostedCockpitPage(undefined, { v4: true, now });

  it("renders the neural constellation as the home, not the V3 dashboard hero", () => {
    assert.match(v4, /<!doctype html>/i);
    assert.match(v4, /syn-field/); // the constellation field
    assert.match(v4, /FLEET CONSTELLATION/);
    assert.match(v4, /class="node star/); // agent stars reuse the .node[data-agent] drawer contract
    assert.match(v4, /syn-vbig/); // the systemBand verdict hero
    assert.match(v4, /coreGrad/); // the central core star gradient
  });

  it("preserves the JS contract + shell invariants under V4", () => {
    for (const hook of ['id="q"', 'id="ask-form"', 'id="q2"', 'class="askcli"', 'id="kbar"', 'id="kq"', 'id="drawer"', 'id="dbody"', 'class="overlay"']) {
      assert.ok(v4.includes(hook), `V4 must keep ${hook}`);
    }
    assert.match(v4, /⌘K/);
    assert.match(v4, /read-only/);
    // the five toggleable views still exist (nav mechanism intact)
    for (const view of ["overview", "agents", "intelligence", "approvals", "technical"]) {
      assert.ok(v4.includes(`data-nav="${view}"`), `keep data-nav ${view}`);
      assert.ok(v4.includes(`data-view="${view}"`), `keep data-view ${view}`);
    }
  });

  it("honest empty state when nothing needs a decision (no fabricated calls)", () => {
    assert.match(v4, /LOOP NOMINAL|nothing needs your decision/i);
  });

  it("the default (no flag) render is unchanged V3 — Synapse stays opt-in", () => {
    const v3 = renderHostedCockpitPage(undefined, { now });
    // assert on the rendered constellation TEXT (the .syn-* CSS class names live in the always-present
    // <style>, so checking the rendered element text is what distinguishes the V4 body from V3).
    assert.doesNotMatch(v3, /FLEET CONSTELLATION/);
    assert.match(v3, /Exception Feed/); // V3 home still leads with the Flight Bridge
  });
});
