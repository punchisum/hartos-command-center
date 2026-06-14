import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  runSelfModPassOnce,
  nextSelfModTask,
  selfModQueuePath,
  resolveVerifyWorkerUrl,
  type QueueFs,
} from "../scripts/run-self-mod-pass.js";
import { PROD_COCKPIT_WORKER_URL } from "../src/execution/self-mod-deploy-worker.js";

// ---------------------------------------------------------------------------
// Fake QueueFs builder — lets each test control the in-memory queue state.
// ---------------------------------------------------------------------------
function fakeFs(opts: { exists?: boolean; content?: string }): QueueFs & { written: string[] } {
  const written: string[] = [];
  return {
    written,
    exists: () => opts.exists ?? true,
    read: () => opts.content ?? "[]",
    write: (_p, d) => { written.push(d); },
  };
}

// ---------------------------------------------------------------------------
// nextSelfModTask — queue reader
// ---------------------------------------------------------------------------
describe("nextSelfModTask (queue reader)", () => {
  it("absent queue file → null", () => {
    const fs = fakeFs({ exists: false });
    assert.equal(nextSelfModTask({}, fs), null);
  });

  it("empty array → null", () => {
    const fs = fakeFs({ content: "[]" });
    assert.equal(nextSelfModTask({}, fs), null);
  });

  it("valid task at head → returns it; file rewritten with rest popped", () => {
    const tasks = [
      { selfModClass: "fix", description: "patch the leaky abstraction" },
      { selfModClass: "extend", description: "add retry logic" },
    ];
    const fs = fakeFs({ content: JSON.stringify(tasks) });
    const result = nextSelfModTask({}, fs);
    assert.deepEqual(result, { selfModClass: "fix", description: "patch the leaky abstraction" });
    // The file must have been rewritten with only the second task remaining.
    assert.equal(fs.written.length, 1);
    const remaining = JSON.parse(fs.written[0]!);
    assert.deepEqual(remaining, [{ selfModClass: "extend", description: "add retry logic" }]);
  });

  it("malformed head entry (missing selfModClass) → null; file still popped", () => {
    const tasks = [{ description: "no class here" }, { selfModClass: "fix", description: "good task" }];
    const fs = fakeFs({ content: JSON.stringify(tasks) });
    const result = nextSelfModTask({}, fs);
    // Malformed head is skipped → returns null.
    assert.equal(result, null);
    // The pop still happened: file rewritten without the malformed head.
    assert.equal(fs.written.length, 1);
    const remaining = JSON.parse(fs.written[0]!);
    assert.deepEqual(remaining, [{ selfModClass: "fix", description: "good task" }]);
  });

  it("malformed head entry (invalid selfModClass value) → null", () => {
    const fs = fakeFs({ content: JSON.stringify([{ selfModClass: "invent", description: "bad class" }]) });
    assert.equal(nextSelfModTask({}, fs), null);
  });

  it("malformed head entry (empty description) → null", () => {
    const fs = fakeFs({ content: JSON.stringify([{ selfModClass: "fix", description: "   " }]) });
    assert.equal(nextSelfModTask({}, fs), null);
  });

  it("corrupt JSON → null; never throws", () => {
    const fs = fakeFs({ content: "{not valid json..." });
    assert.equal(nextSelfModTask({}, fs), null);
  });

  it("non-array JSON → null", () => {
    const fs = fakeFs({ content: JSON.stringify({ selfModClass: "fix", description: "not an array" }) });
    assert.equal(nextSelfModTask({}, fs), null);
  });
});

// ---------------------------------------------------------------------------
// selfModQueuePath — lives outside the repo (in homedir)
// ---------------------------------------------------------------------------
describe("selfModQueuePath", () => {
  it("path is in homedir and named .hartos-self-mod-queue.json", () => {
    const p = selfModQueuePath();
    assert.ok(p.endsWith(".hartos-self-mod-queue.json"), `unexpected path: ${p}`);
    // Must NOT be inside the repo working tree (repo cwd).
    assert.ok(!p.startsWith(process.cwd()), `queue path must be outside repo: ${p}`);
  });
});

// ---------------------------------------------------------------------------
// resolveVerifyWorkerUrl — deploy/verify must name the SAME worker (Finding 1)
// ---------------------------------------------------------------------------
describe("resolveVerifyWorkerUrl (deploy/verify same-worker binding)", () => {
  it("defaults to the live cockpit worker when nothing is set", () => {
    assert.equal(resolveVerifyWorkerUrl({}), PROD_COCKPIT_WORKER_URL);
  });

  it("IGNORES STAGING_CLOUDFLARE_WORKER_URL — a staging override must not steer prod verify", () => {
    const url = resolveVerifyWorkerUrl({ STAGING_CLOUDFLARE_WORKER_URL: "https://staging.example.workers.dev" });
    assert.equal(url, PROD_COCKPIT_WORKER_URL, "staging var must never become the prod verify target");
  });

  it("CLOUDFLARE_WORKER_URL overrides for an explicit URL change (e.g. custom domain)", () => {
    const url = resolveVerifyWorkerUrl({ CLOUDFLARE_WORKER_URL: "https://cockpit.hartos.dev" });
    assert.equal(url, "https://cockpit.hartos.dev");
  });

  it("blank CLOUDFLARE_WORKER_URL falls back to the live worker (never an empty host)", () => {
    assert.equal(resolveVerifyWorkerUrl({ CLOUDFLARE_WORKER_URL: "   " }), PROD_COCKPIT_WORKER_URL);
  });
});

// ---------------------------------------------------------------------------
// runSelfModPassOnce — gated no-op
// ---------------------------------------------------------------------------
describe("runSelfModPassOnce (gated no-op)", () => {
  it("disarmed (no flags) → silent no-op, returns []", async () => {
    const r = await runSelfModPassOnce({}, new Date("2026-06-14T00:00:00Z"));
    assert.deepEqual(r, []);
  });

  it("armed but no queued task → no-op, returns []", async () => {
    // The real queue file at ~/.hartos-self-mod-queue.json almost certainly doesn't
    // exist in the CI/test environment; if it does, this test may pass coincidentally
    // (the queue is empty or absent). The disarmed guard is tested above; this test
    // confirms the armed-but-no-task code path returns [] when the queue is absent.
    // Note: if a real queue file IS present and non-empty this test could flake —
    // that scenario is intentional (Hart controls the file; test assumes clean env).
    const armed = { HARTOS_SELFMOD_AMENDMENT_APPROVED: "true", HARTOS_ALLOW_SELF_MOD: "true" };
    const r = await runSelfModPassOnce(armed, new Date("2026-06-14T00:00:00Z"));
    assert.deepEqual(r, [], "no queued task → no-op even when armed");
  });
});
