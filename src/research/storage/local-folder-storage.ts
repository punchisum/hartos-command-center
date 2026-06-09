/**
 * src/research/storage/local-folder-storage.ts — the first CONCRETE StorageAdapter writer.
 *
 * Plan §9 — "Writing an artifact to a store IS a mutation." So a storage writer is NOT a
 * privileged side-door: it is an ExecutionAdapter like any other and inherits the whole
 * doctrine. Mirrors the gated-adapter style of ../../execution/adapters/archive-rejected.ts:
 *
 *   - GATED, default-OFF: its own per-action allowlist flag (`ALLOW_STORAGE_LOCAL_FOLDER`)
 *     is ABSENT by default ⇒ the action is OFF until deliberately enabled, and the global
 *     kill-switch (HARTOS_EXECUTION_KILL_SWITCH=on) overrides it. The gate is enforced by
 *     the ONE runner — `runExecutionAdapter` (../../execution/execution-adapter.ts) — which
 *     audits the attempt, runs the fail-closed precondition + the allowlist check, and only
 *     then calls `execute`. This adapter does NOT re-implement that gate; it assumes the
 *     runner enforces it (see test note).
 *   - DRY-RUN-able: `dryRun` reports what WOULD be written (resolved path + byte count) and
 *     performs no I/O write.
 *   - READ-BEFORE-WRITE + IDEMPOTENT: it reads the target first. Identical content already
 *     present ⇒ a no-op (ran:false). Different content present ⇒ REFUSED (no silent
 *     overwrite) unless the intent explicitly opts into overwrite. Default = REFUSE.
 *   - PATH-SAFE: refuses any artifactPath that escapes the approved base folder (`..`
 *     traversal, absolute paths, drive letters, UNC) — fail-closed.
 *   - SECRET-SAFE: refuses to write content that contains a secret-shaped token (reuses the
 *     repo's `containsSecret` from ../../llm/redaction.js) — names/paths only in any report.
 *   - REVERSIBLE: every outcome carries a correction note (how to undo: delete the file).
 *
 * INJECTED I/O SEAM (no real disk in tests). All filesystem access goes through an injected
 * `StorageFs` (exists/readFile/writeFile/mkdir). Tests pass a fake; the LIVE seam is built by
 * a factory (`createNodeStorageFs`) that imports `node:fs/promises` — kept OUT of the pure
 * adapter logic so the adapter is unit-testable with zero disk, exactly like the pg stores
 * keep `pg` in a separate `-db` builder. The factory is the only place Node fs is touched.
 *
 * APPROVAL: a write is refused unless `intent.target.approved` is true, `target.type` matches
 * this adapter's `targetType`, and the resolved path stays under `target.locator` (the approved
 * base). A new/unapproved target requires explicit Hart approval before its first write (§9).
 */

import type {
  StorageAdapter,
  StorageWriteIntent,
  StorageTarget,
  StorageTargetType,
} from "../storage-adapter.js";
import type { ExecutionOutcome } from "../../execution/execution-adapter.js";
import { containsSecret } from "../../llm/redaction.js";

/** Per-action allowlist flag — absent by default, so local-folder writes are OFF until enabled. */
export const STORAGE_LOCAL_FOLDER_FLAG = "ALLOW_STORAGE_LOCAL_FOLDER";

/**
 * The injected filesystem seam. Minimal on purpose — only what a single gated, idempotent,
 * read-before-write artifact write needs. The LIVE impl (createNodeStorageFs) wraps
 * `node:fs/promises`; tests pass an in-memory fake. Paths are already-resolved POSIX-style
 * absolute-under-base paths (the adapter resolves + safety-checks before calling the seam).
 */
export interface StorageFs {
  /** True iff a file exists at `path`. */
  exists(path: string): Promise<boolean>;
  /** Read the file's UTF-8 content. Only called after `exists` returned true. */
  readFile(path: string): Promise<string>;
  /** Ensure the directory `dir` exists (recursive mkdir -p). */
  mkdir(dir: string): Promise<void>;
  /** Write `content` to `path` (UTF-8), creating/overwriting the file. */
  writeFile(path: string, content: string): Promise<void>;
}

/**
 * Deps for ONE local-folder write. Extends the interface's StorageWriteDeps contract
 * ({ intent }) with the injected fs seam + the artifact content. `dryRun`/`execute` share it,
 * exactly like ExecutionAdapter<D>. (The base StorageWriteDeps deliberately declares no fs —
 * the concrete writer supplies its own seam, behind its own flag; see storage-adapter.ts.)
 */
export interface LocalFolderWriteDeps {
  intent: StorageWriteIntent;
  /** The markdown/report content to write (names only — never secrets; refused if it has one). */
  content: string;
  /** Injected filesystem seam (fake in tests, node:fs/promises live). */
  fs: StorageFs;
  /** Opt-in overwrite of an existing file with DIFFERENT content. Default false ⇒ REFUSE. */
  overwrite?: boolean;
}

/** Byte length of UTF-8 content, without touching disk. */
export function byteSizeOf(content: string): number {
  return Buffer.byteLength(content, "utf8");
}

/** Normalize a path separator set to POSIX-style for deterministic, cross-platform reasoning. */
function toPosix(p: string): string {
  return p.replace(/\\/g, "/");
}

/**
 * A path-safety check shared by both writers. Refuses (fail-closed) any artifactPath that is
 * not a clean relative path strictly under the approved base:
 *   - absolute POSIX paths (leading "/"),
 *   - Windows drive letters ("C:\\..."),
 *   - UNC paths ("\\\\server\\share"),
 *   - any ".." traversal segment (even after normalization),
 *   - empty / directory-only paths.
 * Returns the resolved POSIX path under `base` when safe, or a denial reason.
 */
export function resolveSafePath(
  base: string,
  artifactPath: string,
): { ok: true; resolved: string; dir: string } | { ok: false; reason: string } {
  const rawPath = toPosix(artifactPath ?? "");
  if (rawPath.trim().length === 0) {
    return { ok: false, reason: "artifactPath is empty" };
  }
  // Absolute / drive-letter / UNC — never allowed; the path MUST be relative to the base.
  if (rawPath.startsWith("/")) {
    return { ok: false, reason: `absolute path refused: "${artifactPath}"` };
  }
  if (/^[A-Za-z]:/.test(rawPath)) {
    return { ok: false, reason: `drive-letter path refused: "${artifactPath}"` };
  }
  if (toPosix(artifactPath).startsWith("//") || artifactPath.startsWith("\\\\")) {
    return { ok: false, reason: `UNC path refused: "${artifactPath}"` };
  }
  // Reject any ".." segment outright (before AND a defensive check after normalization).
  const segments = rawPath.split("/").filter((s) => s.length > 0 && s !== ".");
  if (segments.some((s) => s === "..")) {
    return { ok: false, reason: `path traversal ("..") refused: "${artifactPath}"` };
  }
  if (segments.length === 0) {
    return { ok: false, reason: `artifactPath resolves to no file: "${artifactPath}"` };
  }

  const cleanBase = toPosix(base).replace(/\/+$/g, "");
  if (cleanBase.length === 0) {
    return { ok: false, reason: "approved base locator is empty" };
  }
  const resolved = `${cleanBase}/${segments.join("/")}`;
  // Defensive: the resolved path must remain strictly under the base, prefix-wise.
  if (resolved !== cleanBase && !resolved.startsWith(`${cleanBase}/`)) {
    return { ok: false, reason: `resolved path escapes approved base: "${artifactPath}"` };
  }
  const lastSlash = resolved.lastIndexOf("/");
  const dir = resolved.slice(0, lastSlash);
  return { ok: true, resolved, dir };
}

/** A short note on how to undo a given write — every outcome carries one. */
export function correctionNoteFor(resolved: string): string {
  return `To undo: delete the written file at "${resolved}". The write is reversible (single new/identical file); nothing else is touched.`;
}

/**
 * The shared, PURE core that both the local-folder and Obsidian adapters run. It is generic
 * over the deps so the Obsidian writer can reuse it with its own target-type guard and any
 * content transform applied BEFORE this is called. It performs: approval/target guard →
 * path-safety → secret-safety → read-before-write (idempotent/refuse) → gated write. It does
 * NOT enforce the allowlist/kill-switch — that is `runExecutionAdapter`'s job (this core only
 * runs once the runner has let it through, or when a test calls it directly).
 */
export async function runStorageWriteCore(
  deps: LocalFolderWriteDeps,
  targetType: StorageTargetType,
  mode: "dryRun" | "execute",
): Promise<ExecutionOutcome> {
  const { intent, content, fs } = deps;
  const target = intent.target;
  const size = byteSizeOf(content);

  const refusal = (summary: string): ExecutionOutcome => ({
    ran: false,
    reversible: true,
    before: { existed: null, refused: true },
    after: { existed: null, wrote: false },
    summary,
  });

  // 1) APPROVAL + TARGET-TYPE guard (§9). A new/unapproved target needs explicit Hart approval.
  if (!supportsTargetFor(target, targetType)) {
    return refusal(
      `Refused: target "${target.id}" (type=${target.type}, approved=${target.approved}) is not an approved ${targetType} target. A new/unapproved target requires explicit Hart approval before any write (§9).`,
    );
  }

  // 2) PATH SAFETY — refuse traversal / absolute / drive-letter / UNC, fail-closed.
  const safe = resolveSafePath(target.locator, intent.artifactPath);
  if (!safe.ok) {
    return refusal(`Refused (path safety): ${safe.reason}. Nothing written.`);
  }
  const { resolved, dir } = safe;

  // 3) SECRET SAFETY — never persist secret-shaped content (names/paths only in reports).
  if (containsSecret(content)) {
    return refusal(
      `Refused (secret safety): artifact content for "${resolved}" contains a secret-shaped token. Reports carry names/paths only — never raw secrets. Nothing written.`,
    );
  }

  // 4) READ-BEFORE-WRITE — determine idempotency / refuse a silent overwrite.
  const existed = await fs.exists(resolved);
  let sameContent = false;
  if (existed) {
    const current = await fs.readFile(resolved);
    sameContent = current === content;
    if (!sameContent && deps.overwrite !== true) {
      return refusal(
        `Refused (no silent overwrite): "${resolved}" already exists with DIFFERENT content and overwrite was not requested. Re-run with an explicit overwrite intent to replace it.`,
      );
    }
  }

  // DRY-RUN — report exactly what WOULD happen; perform NO write.
  if (mode === "dryRun") {
    const verb = !existed
      ? `create a new file (${size} byte(s))`
      : sameContent
        ? "make NO change (identical content already present — idempotent no-op)"
        : `OVERWRITE the existing file with ${size} byte(s) (explicit overwrite requested)`;
    return {
      ran: false,
      reversible: true,
      before: { existed, sameContent },
      after: { existed, sameContent, wouldWriteBytes: !existed || !sameContent ? size : 0 },
      summary: `Dry-run: would ${verb} at "${resolved}". No writes performed. ${correctionNoteFor(resolved)}`,
    };
  }

  // 5) IDEMPOTENT no-op — identical content already present ⇒ ran:false, no write.
  if (existed && sameContent) {
    return {
      ran: false,
      reversible: true,
      before: { existed: true, bytes: size },
      after: { existed: true, bytes: size, wrote: false },
      summary: `No-op: "${resolved}" already holds identical content (${size} byte(s)). Idempotent re-run wrote nothing. ${correctionNoteFor(resolved)}`,
    };
  }

  // 6) GATED WRITE — mkdir -p then write (the runner has already enforced the gate).
  await fs.mkdir(dir);
  await fs.writeFile(resolved, content);
  return {
    ran: true,
    reversible: true,
    before: { existed, bytes: existed ? size : 0 },
    after: { existed: true, bytes: size, wrote: true, path: resolved },
    summary: `Wrote ${existed ? "(overwrote) " : ""}${size} byte(s) to "${resolved}". ${correctionNoteFor(resolved)}`,
  };
}

/** Shared target guard: the target must be approved AND its type must match this adapter. */
export function supportsTargetFor(target: StorageTarget, targetType: StorageTargetType): boolean {
  return target.approved === true && target.type === targetType;
}

/**
 * Build the local-folder StorageAdapter. The fs seam rides on the deps (so the same adapter
 * object is usable with a fake fs in tests and a live fs in Node) — no module-level fs import.
 */
export const localFolderStorageAdapter: StorageAdapter = {
  id: "storage-local-folder",
  allowlistFlag: STORAGE_LOCAL_FOLDER_FLAG,
  targetType: "local-folder",

  supportsTarget(target: StorageTarget): boolean {
    return supportsTargetFor(target, "local-folder");
  },

  async dryRun(deps: unknown): Promise<ExecutionOutcome> {
    return runStorageWriteCore(deps as LocalFolderWriteDeps, "local-folder", "dryRun");
  },

  async execute(deps: unknown): Promise<ExecutionOutcome> {
    return runStorageWriteCore(deps as LocalFolderWriteDeps, "local-folder", "execute");
  },
};

/**
 * LIVE factory — the ONLY place Node fs is touched. Returns a StorageFs backed by
 * `node:fs/promises`, resolving paths relative to nothing (the adapter already produced a
 * POSIX path under the approved base; on Windows node accepts forward slashes). Never executed
 * in tests. Imported lazily so importing this module pulls no Node fs into the bundle.
 */
export async function createNodeStorageFs(): Promise<StorageFs> {
  const nodeFs = await import("node:fs/promises");
  return {
    async exists(path: string): Promise<boolean> {
      try {
        await nodeFs.access(path);
        return true;
      } catch {
        return false;
      }
    },
    readFile(path: string): Promise<string> {
      return nodeFs.readFile(path, "utf8");
    },
    async mkdir(dir: string): Promise<void> {
      await nodeFs.mkdir(dir, { recursive: true });
    },
    writeFile(path: string, content: string): Promise<void> {
      return nodeFs.writeFile(path, content, "utf8");
    },
  };
}
