/**
 * tests/organ-adapter-ops.test.ts — the Ops organ adapter contract.
 *
 * Ops is a READ-ONLY projection of the separate GECAN ops Supabase. These tests assert
 * run() always returns a well-formed OrganRunResult and never throws, and that the
 * doctrine holds: an honest PARTIAL when the GECAN read-model is not wired daemon-side,
 * and a DERIVED ok:true only when a real sync_runs row reads back (never fabricated).
 *
 * The live-path test stubs globalThis.fetch so NO real network call occurs; it is always
 * restored in finally. The PARTIAL/empty/error paths need no network at all.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { opsOrgan } from "../src/organs/adapters/ops.js";

const NOW = "2026-06-14T00:00:00Z";
const LIVE_ENV = {
  HARTOS_OPS_SUPABASE_URL: "https://tbdkveyixqjksamcdemr.supabase.co",
  HARTOS_OPS_SUPABASE_READONLY_KEY: "anon-read-only-key",
} as NodeJS.ProcessEnv;

/** Assert the universal OrganRunResult shape (used by every case). */
function assertWellFormed(res: { ok: unknown; outputRef: unknown; summary: unknown; detail?: unknown }): void {
  assert.equal(typeof res.ok, "boolean");
  // outputRef is a SOT-readable handle (string) or null — never undefined.
  assert.ok(res.outputRef === null || typeof res.outputRef === "string");
  assert.equal(typeof res.summary, "string");
  const summary = res.summary as string;
  assert.ok(summary.length > 0 && summary.length <= 300);
  if (res.detail !== undefined) {
    assert.equal(typeof res.detail, "object");
    assert.notEqual(res.detail, null);
  }
}

/** Swap globalThis.fetch for one run, always restoring it. */
async function withFetch<T>(fake: typeof fetch, fn: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  (globalThis as { fetch: typeof fetch }).fetch = fake;
  try {
    return await fn();
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = original;
  }
}

test("opsOrgan declares the contracted identity + always-on (no arming gate)", () => {
  assert.equal(opsOrgan.organId, "ops");
  assert.equal(opsOrgan.armingFlag, null);
  assert.equal(typeof opsOrgan.run, "function");
});

test("run() with empty env returns the honest PARTIAL — not wired daemon-side", async () => {
  const res = await opsOrgan.run({}, NOW);
  assert.equal(res.ok, false);
  assert.equal(res.outputRef, null);
  assert.equal(res.summary, "ops projection: GECAN read-model not wired daemon-side");
  assertWellFormed(res);
});

test("run() with only the URL (no key) is still an honest PARTIAL", async () => {
  const res = await opsOrgan.run(
    { HARTOS_OPS_SUPABASE_URL: "https://tbdkveyixqjksamcdemr.supabase.co" } as NodeJS.ProcessEnv,
    NOW,
  );
  assert.equal(res.ok, false);
  assert.equal(res.outputRef, null);
  assert.equal(res.summary, "ops projection: GECAN read-model not wired daemon-side");
  assertWellFormed(res);
});

test("run() derives ok:true from a real sync_runs row (no fabrication)", async () => {
  const fake = (async () => ({
    ok: true,
    status: 200,
    json: async () => [{ id: "sync-abc-123", outcome: "ok", created_at: "2026-06-14T09:30:00Z" }],
  })) as unknown as typeof fetch;

  const res = await withFetch(fake, () => opsOrgan.run(LIVE_ENV, NOW));
  assert.equal(res.ok, true);
  assert.equal(res.outputRef, "sync-abc-123");
  assert.equal(res.summary, "latest GECAN sync @ 2026-06-14T09:30:00Z");
  assertWellFormed(res);
});

test("run() with env wired but empty sync_runs is an honest ok:false", async () => {
  const fake = (async () => ({ ok: true, status: 200, json: async () => [] })) as unknown as typeof fetch;

  const res = await withFetch(fake, () => opsOrgan.run(LIVE_ENV, NOW));
  assert.equal(res.ok, false);
  assert.equal(res.outputRef, null);
  assertWellFormed(res);
});

test("run() never throws even when the GECAN read errors out", async () => {
  const fake = (async () => ({
    ok: false,
    status: 403,
    json: async () => ({ message: "forbidden" }),
  })) as unknown as typeof fetch;

  await assert.doesNotReject(async () => {
    const res = await withFetch(fake, () => opsOrgan.run(LIVE_ENV, NOW));
    assert.equal(res.ok, false);
    assert.equal(res.outputRef, null);
    assertWellFormed(res);
  });
});

test("run() never throws on a thrown fetch (network failure)", async () => {
  const fake = (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;

  await assert.doesNotReject(async () => {
    const res = await withFetch(fake, () => opsOrgan.run(LIVE_ENV, NOW));
    assert.equal(res.ok, false);
    assert.equal(res.outputRef, null);
    assertWellFormed(res);
  });
});
