import { test } from "node:test";
import assert from "node:assert/strict";

import { gatherHeartbeats } from "../src/sentinel/heartbeat-gatherer.js";

test("gatherHeartbeats sanitizes a future read-model snapshot so the domain is not falsely fresh", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hbs = gatherHeartbeats({
    nowIso: now,
    readModel: { enabledSources: ["fitness"], staleSources: [], snapshotAt: "2026-06-12T11:00:00.000Z" },
  });

  const fitness = hbs.find((h) => h.agentId === "fitness");
  assert.ok(fitness, "fitness heartbeat present");
  // Future snapshot must be dropped to null (→ unknown downstream), never carried as fresh.
  assert.equal(fitness.lastEvidenceAt, null);
});

test("gatherHeartbeats always includes the answering Worker as fresh self-evidence", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hbs = gatherHeartbeats({
    nowIso: now,
    readModel: { enabledSources: [], staleSources: [], snapshotAt: null },
  });

  const cockpit = hbs.find((h) => h.agentId === "cockpit");
  assert.ok(cockpit, "cockpit heartbeat present");
  assert.equal(cockpit.lastEvidenceAt, now);
});

test("gatherHeartbeats carries an upstream-stale read-model through with the flag set", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hbs = gatherHeartbeats({
    nowIso: now,
    readModel: { enabledSources: ["ops"], staleSources: ["ops"], snapshotAt: "2026-06-12T08:00:00.000Z" },
  });

  const ops = hbs.find((h) => h.agentId === "ops");
  assert.ok(ops, "ops heartbeat present");
  assert.equal(ops.upstreamStale, true);
});

test("gatherHeartbeats normalizes local-runner evidence and omits sources it never saw", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hbs = gatherHeartbeats({
    nowIso: now,
    readModel: { enabledSources: [], staleSources: [], snapshotAt: null },
    localRunner: [
      { agentId: "research", observedAt: "2026-06-12T09:30:00.000Z", evidenceSource: "research job artifact" },
    ],
  });

  const research = hbs.find((h) => h.agentId === "research");
  assert.ok(research, "research heartbeat present from local-runner evidence");
  assert.equal(research.lastEvidenceAt, "2026-06-12T09:30:00.000Z");
  // An agent with no gathered source (e.g. wolverine) is simply absent → unknown downstream.
  assert.equal(hbs.find((h) => h.agentId === "wolverine"), undefined);
});
