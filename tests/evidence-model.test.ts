import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeEvidence } from "../src/sentinel/evidence-model.js";

// The truth layer must never report an agent "up" on evidence it cannot trust.
// A timestamp in the FUTURE cannot be evidence that something already ran, so it
// must be dropped (lastEvidenceAt -> null) and surface as "unknown" downstream.
test("normalizeEvidence drops a future timestamp so an agent is never falsely 'up'", () => {
  const now = "2026-06-12T10:00:00.000Z";
  const future = "2026-06-12T11:00:00.000Z";

  const hb = normalizeEvidence(
    { agentId: "prophet", observedAt: future, evidenceSource: "prophet forecast run" },
    now,
  );

  assert.equal(hb.lastEvidenceAt, null);
  assert.equal(hb.agentId, "prophet");
  assert.equal(hb.evidenceSource, "prophet forecast run");
});

test("normalizeEvidence carries a valid past timestamp through unchanged", () => {
  const now = "2026-06-12T10:00:00.000Z";
  const past = "2026-06-12T08:30:00.000Z";

  const hb = normalizeEvidence(
    { agentId: "fitness", observedAt: past, evidenceSource: "fitness read-model snapshot" },
    now,
  );

  assert.equal(hb.lastEvidenceAt, past);
});

test("normalizeEvidence drops an unparseable timestamp to null", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hb = normalizeEvidence(
    { agentId: "ops", observedAt: "not-a-real-date", evidenceSource: "ops read-model" },
    now,
  );

  assert.equal(hb.lastEvidenceAt, null);
});

test("normalizeEvidence treats a null timestamp as no evidence", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hb = normalizeEvidence(
    { agentId: "ops", observedAt: null, evidenceSource: "ops read-model" },
    now,
  );

  assert.equal(hb.lastEvidenceAt, null);
});

test("normalizeEvidence preserves the upstreamStale flag", () => {
  const now = "2026-06-12T10:00:00.000Z";

  const hb = normalizeEvidence(
    {
      agentId: "ops",
      observedAt: "2026-06-12T09:00:00.000Z",
      evidenceSource: "ops read-model diagnostics",
      upstreamStale: true,
    },
    now,
  );

  assert.equal(hb.upstreamStale, true);
  assert.equal(hb.lastEvidenceAt, "2026-06-12T09:00:00.000Z");
});
