/**
 * tests/research-storage.test.ts
 *
 * Hermetic tests for the two concrete StorageAdapter writers (local-folder + Obsidian).
 * NO real disk, NO network, NO clock reads: a fake in-memory `StorageFs` is injected, so
 * the live `node:fs/promises` factory (createNodeStorageFs) is NEVER touched here.
 *
 * Doctrine these prove (plan §9 — "writing an artifact IS a mutation"):
 *   - dryRun ⇒ no write, reports intended resolved path + byte size.
 *   - happy path (fake fs) ⇒ writes once, before/after + correction note; idempotent re-run
 *     with identical content ⇒ no-op (ran:false, no second write).
 *   - existing file with DIFFERENT content ⇒ refused (no silent overwrite), nothing written.
 *   - path-escape (../, absolute, drive-letter) ⇒ refused, nothing written.
 *   - secret-bearing content ⇒ refused, nothing written.
 *   - GATING note: the StorageAdapter's allowlist flag (default-OFF) + kill-switch are
 *     enforced by the ONE runner `runExecutionAdapter`, NOT by the adapter's execute(). We
 *     assert (a) the adapter declares a default-OFF flag, and (b) isActionAllowlisted gates
 *     it via the runner — so calling execute() directly in the other tests is the post-gate
 *     path the runner would reach only when the flag is "true".
 *   - Obsidian: writes `.md` with optional frontmatter; same safety properties.
 */

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  localFolderStorageAdapter,
  STORAGE_LOCAL_FOLDER_FLAG,
  byteSizeOf,
  resolveSafePath,
  type StorageFs,
  type LocalFolderWriteDeps,
} from "../src/research/storage/local-folder-storage.js";
import {
  obsidianStorageAdapter,
  STORAGE_OBSIDIAN_FLAG,
  withMdExtension,
  renderFrontmatter,
  type ObsidianWriteDeps,
} from "../src/research/storage/obsidian-storage.js";
import type { StorageTarget, StorageWriteIntent } from "../src/research/storage-adapter.js";
import { isActionAllowlisted, KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";

/** An in-memory fake StorageFs — records every write/mkdir; no real disk. */
function makeFakeFs(seed: Record<string, string> = {}): StorageFs & {
  files: Map<string, string>;
  mkdirs: string[];
  writes: number;
} {
  const files = new Map<string, string>(Object.entries(seed));
  const mkdirs: string[] = [];
  let writes = 0;
  return {
    files,
    mkdirs,
    get writes() {
      return writes;
    },
    async exists(path: string): Promise<boolean> {
      return files.has(path);
    },
    async readFile(path: string): Promise<string> {
      const v = files.get(path);
      if (v === undefined) throw new Error(`fake fs: no such file ${path}`);
      return v;
    },
    async mkdir(dir: string): Promise<void> {
      mkdirs.push(dir);
    },
    async writeFile(path: string, content: string): Promise<void> {
      files.set(path, content);
      writes++;
    },
  };
}

const APPROVED_TARGET: StorageTarget = {
  id: "research-approved-local",
  type: "local-folder",
  name: "Research / approved (local)",
  locator: "research/approved",
  approved: true,
  approvedBy: "Hart",
  approvedAt: "2026-06-09T00:00:00.000Z",
};

const OBSIDIAN_TARGET: StorageTarget = {
  id: "research-vault",
  type: "obsidian",
  name: "Research vault / findings",
  locator: "Vault/Research",
  approved: true,
  approvedBy: "Hart",
  approvedAt: "2026-06-09T00:00:00.000Z",
};

function intentFor(target: StorageTarget, artifactPath: string): StorageWriteIntent {
  return {
    id: "intent-1",
    target,
    artifactPath,
    artifactKind: "full research report",
    idempotencyKey: `${target.id}:${artifactPath}`,
  };
}

const REPORT = "# Findings\n\nVirtual cards: 3 candidates. Approval rates differ by region.\n";

describe("resolveSafePath (shared path safety)", () => {
  test("resolves a clean relative path under the base", () => {
    const r = resolveSafePath("research/approved", "2026-06/report.md");
    assert.equal(r.ok, true);
    if (r.ok) {
      assert.equal(r.resolved, "research/approved/2026-06/report.md");
      assert.equal(r.dir, "research/approved/2026-06");
    }
  });

  for (const bad of ["../escape.md", "a/../../x.md", "/etc/passwd", "C:\\Windows\\x.md", "\\\\srv\\share\\x.md", ""]) {
    test(`refuses unsafe path ${JSON.stringify(bad)}`, () => {
      const r = resolveSafePath("research/approved", bad);
      assert.equal(r.ok, false);
    });
  }
});

describe("localFolderStorageAdapter — gating contract", () => {
  test("declares a default-OFF allowlist flag and correct identity", () => {
    assert.equal(localFolderStorageAdapter.id, "storage-local-folder");
    assert.equal(localFolderStorageAdapter.allowlistFlag, STORAGE_LOCAL_FOLDER_FLAG);
    assert.equal(localFolderStorageAdapter.targetType, "local-folder");
    // Flag absent ⇒ OFF (the runner refuses to call execute()).
    assert.equal(isActionAllowlisted(localFolderStorageAdapter, {}), false);
  });

  test("the runner's allowlist gate flips ON only when the flag is exactly 'true'", () => {
    assert.equal(isActionAllowlisted(localFolderStorageAdapter, { [STORAGE_LOCAL_FOLDER_FLAG]: "true" }), true);
    // Kill-switch overrides the per-action flag.
    assert.equal(
      isActionAllowlisted(localFolderStorageAdapter, {
        [STORAGE_LOCAL_FOLDER_FLAG]: "true",
        [KILL_SWITCH_ENV]: "on",
      }),
      false,
    );
  });

  test("supportsTarget: only an approved local-folder target", () => {
    assert.equal(localFolderStorageAdapter.supportsTarget(APPROVED_TARGET), true);
    assert.equal(localFolderStorageAdapter.supportsTarget({ ...APPROVED_TARGET, approved: false }), false);
    assert.equal(localFolderStorageAdapter.supportsTarget({ ...APPROVED_TARGET, type: "obsidian" }), false);
  });
});

describe("localFolderStorageAdapter — dryRun", () => {
  test("reports intended path + byte size and writes nothing", async () => {
    const fs = makeFakeFs();
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "2026-06/report.md"), content: REPORT, fs };
    const outcome = await localFolderStorageAdapter.dryRun(deps);

    assert.equal(outcome.ran, false);
    assert.equal(outcome.reversible, true);
    assert.equal(outcome.after.wouldWriteBytes, byteSizeOf(REPORT));
    assert.match(outcome.summary, /research\/approved\/2026-06\/report\.md/);
    assert.match(outcome.summary, /No writes performed/);
    assert.match(outcome.summary, /To undo: delete/);
    assert.equal(fs.writes, 0);
    assert.equal(fs.files.size, 0);
  });
});

describe("localFolderStorageAdapter — execute (happy + idempotent)", () => {
  test("writes once with before/after + correction note", async () => {
    const fs = makeFakeFs();
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "2026-06/report.md"), content: REPORT, fs };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, true);
    assert.equal(outcome.reversible, true);
    assert.equal(outcome.before.existed, false);
    assert.equal(outcome.after.wrote, true);
    assert.equal(outcome.after.path, "research/approved/2026-06/report.md");
    assert.match(outcome.summary, /To undo: delete/);
    assert.equal(fs.writes, 1);
    assert.equal(fs.files.get("research/approved/2026-06/report.md"), REPORT);
    assert.deepEqual(fs.mkdirs, ["research/approved/2026-06"]);
  });

  test("idempotent re-run with identical content ⇒ no-op, no second write", async () => {
    const path = "research/approved/2026-06/report.md";
    const fs = makeFakeFs({ [path]: REPORT });
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "2026-06/report.md"), content: REPORT, fs };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /No-op/);
    assert.match(outcome.summary, /identical content/);
    assert.equal(fs.writes, 0);
  });
});

describe("localFolderStorageAdapter — refusals (nothing written)", () => {
  test("existing file with DIFFERENT content ⇒ refuse, no overwrite", async () => {
    const path = "research/approved/2026-06/report.md";
    const fs = makeFakeFs({ [path]: "OLD CONTENT" });
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "2026-06/report.md"), content: REPORT, fs };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /no silent overwrite/i);
    assert.equal(fs.writes, 0);
    assert.equal(fs.files.get(path), "OLD CONTENT");
  });

  test("explicit overwrite=true ⇒ replaces different content", async () => {
    const path = "research/approved/2026-06/report.md";
    const fs = makeFakeFs({ [path]: "OLD CONTENT" });
    const deps: LocalFolderWriteDeps = {
      intent: intentFor(APPROVED_TARGET, "2026-06/report.md"),
      content: REPORT,
      fs,
      overwrite: true,
    };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, true);
    assert.equal(fs.writes, 1);
    assert.equal(fs.files.get(path), REPORT);
  });

  test("path-escape (../) ⇒ refuse, nothing written", async () => {
    const fs = makeFakeFs();
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "../../etc/x.md"), content: REPORT, fs };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /path safety/i);
    assert.equal(fs.writes, 0);
    assert.equal(fs.mkdirs.length, 0);
  });

  test("absolute path ⇒ refuse, nothing written", async () => {
    const fs = makeFakeFs();
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "/etc/passwd"), content: REPORT, fs };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /path safety/i);
    assert.equal(fs.writes, 0);
  });

  test("secret-bearing content ⇒ refuse, nothing written", async () => {
    const fs = makeFakeFs();
    const secretReport = `# Findings\n\ntoken=sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ012345\n`;
    const deps: LocalFolderWriteDeps = { intent: intentFor(APPROVED_TARGET, "2026-06/report.md"), content: secretReport, fs };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /secret safety/i);
    assert.equal(fs.writes, 0);
    assert.equal(fs.files.size, 0);
  });

  test("unapproved target ⇒ refuse, nothing written", async () => {
    const fs = makeFakeFs();
    const deps: LocalFolderWriteDeps = {
      intent: intentFor({ ...APPROVED_TARGET, approved: false }, "2026-06/report.md"),
      content: REPORT,
      fs,
    };
    const outcome = await localFolderStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /not an approved/i);
    assert.equal(fs.writes, 0);
  });
});

describe("obsidianStorageAdapter — vault conventions + safety", () => {
  test("withMdExtension + renderFrontmatter helpers", () => {
    assert.equal(withMdExtension("note"), "note.md");
    assert.equal(withMdExtension("note.md"), "note.md");
    const fm = renderFrontmatter({ tags: ["research", "cards"], created: "2026-06-09", source: "internal" });
    assert.match(fm, /^---\n/);
    assert.match(fm, /tags:\n  - research\n  - cards/);
    assert.match(fm, /created: 2026-06-09/);
    assert.match(fm, /---\n\n$/);
  });

  test("declares a default-OFF flag, obsidian targetType, and approved-target guard", () => {
    assert.equal(obsidianStorageAdapter.id, "storage-obsidian");
    assert.equal(obsidianStorageAdapter.allowlistFlag, STORAGE_OBSIDIAN_FLAG);
    assert.equal(obsidianStorageAdapter.targetType, "obsidian");
    assert.equal(isActionAllowlisted(obsidianStorageAdapter, {}), false);
    assert.equal(obsidianStorageAdapter.supportsTarget(OBSIDIAN_TARGET), true);
    assert.equal(obsidianStorageAdapter.supportsTarget(APPROVED_TARGET), false); // wrong type
  });

  test("writes a .md note with frontmatter (forces extension)", async () => {
    const fs = makeFakeFs();
    const deps: ObsidianWriteDeps = {
      intent: intentFor(OBSIDIAN_TARGET, "findings/cards"), // no extension
      content: REPORT,
      fs,
      frontmatter: { tags: ["research"], created: "2026-06-09" },
    };
    const outcome = await obsidianStorageAdapter.execute(deps);

    assert.equal(outcome.ran, true);
    assert.equal(outcome.after.path, "Vault/Research/findings/cards.md");
    const written = fs.files.get("Vault/Research/findings/cards.md");
    assert.ok(written);
    assert.match(written!, /^---\ntags:\n  - research\ncreated: 2026-06-09\n---\n\n# Findings/);
  });

  test("dryRun reports the .md path and writes nothing", async () => {
    const fs = makeFakeFs();
    const deps: ObsidianWriteDeps = { intent: intentFor(OBSIDIAN_TARGET, "findings/cards"), content: REPORT, fs };
    const outcome = await obsidianStorageAdapter.dryRun(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /Vault\/Research\/findings\/cards\.md/);
    assert.equal(fs.writes, 0);
  });

  test("idempotent: re-writing identical note (incl. frontmatter) ⇒ no-op", async () => {
    const fs = makeFakeFs();
    const deps: ObsidianWriteDeps = {
      intent: intentFor(OBSIDIAN_TARGET, "findings/cards"),
      content: REPORT,
      fs,
      frontmatter: { tags: ["research"] },
    };
    const first = await obsidianStorageAdapter.execute(deps);
    assert.equal(first.ran, true);
    assert.equal(fs.writes, 1);

    const second = await obsidianStorageAdapter.execute(deps);
    assert.equal(second.ran, false);
    assert.match(second.summary, /No-op/);
    assert.equal(fs.writes, 1);
  });

  test("path-escape in vault ⇒ refuse, nothing written", async () => {
    const fs = makeFakeFs();
    const deps: ObsidianWriteDeps = { intent: intentFor(OBSIDIAN_TARGET, "../outside"), content: REPORT, fs };
    const outcome = await obsidianStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /path safety/i);
    assert.equal(fs.writes, 0);
  });

  test("secret-bearing note ⇒ refuse, nothing written", async () => {
    const fs = makeFakeFs();
    const deps: ObsidianWriteDeps = {
      intent: intentFor(OBSIDIAN_TARGET, "findings/cards"),
      content: "# Note\n\nghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789\n",
      fs,
    };
    const outcome = await obsidianStorageAdapter.execute(deps);

    assert.equal(outcome.ran, false);
    assert.match(outcome.summary, /secret safety/i);
    assert.equal(fs.writes, 0);
  });
});
