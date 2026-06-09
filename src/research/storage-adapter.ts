/**
 * src/research/storage-adapter.ts
 *
 * Plan §9 — "Artifact storage = mutation." Writing a report to a folder is a MUTATION,
 * so it cannot bypass the single execution gate. This module declares the StorageAdapter
 * INTERFACE and its target taxonomy — types only, no concrete writer, no filesystem
 * access, no Obsidian adapter (explicitly deferred until the Research Agent exists).
 *
 * A StorageAdapter IS an ExecutionAdapter<D> (../execution/execution-adapter.ts). That is
 * deliberate: every artifact write therefore flows through the ONLY way to run an adapter
 * (`runExecutionAdapter`), which writes an audit "attempt" first, calls the fail-closed
 * `checkExecutionPrecondition`, honors the per-action allowlist flag + global kill-switch,
 * and audits the outcome. There is no second, weaker write path.
 *
 * APPROVAL DOCTRINE (plan §9): agents cannot write files everywhere (the ~800 freeform
 * report files are the anti-pattern to kill). Approved targets are a fixed, typed
 * taxonomy. A NEW storage target (or a new concrete target instance — a new folder, a new
 * vault, a new repo, a new bucket) requires EXPLICIT HART APPROVAL before its first write;
 * an adapter MUST refuse a write whose intent does not match a pre-approved StorageTarget.
 */

import type { ExecutionAdapter, ExecutionOutcome } from "../execution/execution-adapter.js";

/**
 * The approved storage target taxonomy (plan §9). Google Drive is intentionally absent —
 * it is "later", and only behind a typed gated adapter (plan §14/§16). Adding a member
 * here is a doctrine change, not a routine edit.
 */
export type StorageTargetType = "local-folder" | "obsidian" | "github-repo" | "supabase-storage";

/**
 * A concrete, pre-approved write destination. The `approved` flag and `approvedBy`/`approvedAt`
 * make Hart's explicit sign-off a first-class, auditable part of the target — an adapter
 * refuses a write to any target that is not `approved`.
 */
export interface StorageTarget {
  /** Stable target id (deterministic — never LLM free text). */
  id: string;
  type: StorageTargetType;
  /** Human label, e.g. "Research vault / virtual-cards". */
  name: string;
  /**
   * The fully-qualified destination locator for this target type:
   *   - local-folder      ⇒ an absolute/approved folder path
   *   - obsidian          ⇒ vault + folder path
   *   - github-repo       ⇒ owner/repo[/path]
   *   - supabase-storage  ⇒ bucket[/prefix]
   * Never a secret/token.
   */
  locator: string;
  /** True ONLY after explicit Hart approval — a write to a non-approved target is refused. */
  approved: boolean;
  /** Who approved this target (set when `approved` is true). */
  approvedBy?: string;
  /** When this target was approved (ISO). */
  approvedAt?: string;
}

/**
 * A single artifact-write intent — the descriptive, no-side-effect payload an adapter's
 * `dryRun` previews and `execute` performs (through the gate). It names the target and the
 * artifact; the adapter is responsible for refusing if `target.approved` is false or the
 * intent's target does not match a pre-approved StorageTarget.
 */
export interface StorageWriteIntent {
  /** Stable intent id. */
  id: string;
  /** The pre-approved destination this write goes to. */
  target: StorageTarget;
  /** The artifact's relative path/name within the target (e.g. "2026-06/report.md"). */
  artifactPath: string;
  /** What is being written (e.g. "full research report"). Descriptive only. */
  artifactKind: string;
  /**
   * Deterministic idempotency key for this write (built via makeIdempotencyKey from
   * trusted fields — never LLM/free text). Re-running the same intent is a no-op.
   */
  idempotencyKey: string;
  /** Byte size of the artifact if known (used against BoundaryDefinition.maxFilesWritten upstream). */
  byteSize?: number;
}

/**
 * Deps a concrete StorageAdapter would receive to perform ONE write. Kept as the adapter's
 * `D` so `dryRun(deps)` and `execute(deps)` share it, exactly like ExecutionAdapter<D>.
 * (No writer/fs is declared here — the concrete adapter that owns the actual write supplies
 * its own implementation later, behind its own allowlist flag.)
 */
export interface StorageWriteDeps {
  intent: StorageWriteIntent;
}

/**
 * The StorageAdapter INTERFACE. It COMPOSES ExecutionAdapter<StorageWriteDeps>, so a write
 * is just an allowlisted, gated, audited, reversible execution. Concrete writers (local
 * folder first; Obsidian/github/supabase later) implement this — each with its own
 * `allowlistFlag` (default OFF) and honoring the kill-switch — but none of that lives here.
 *
 * `targetType` + `supportsTarget` let the orchestrator pick the right adapter for an intent
 * and let the adapter declare the approval-required guard at the type level. A NEW target
 * type needs a new adapter AND explicit Hart approval before its first write (see file header).
 */
export interface StorageAdapter extends ExecutionAdapter<StorageWriteDeps> {
  /** Which target taxonomy member this adapter writes to. */
  readonly targetType: StorageTargetType;
  /**
   * True iff this adapter can write the given target AND the target is approved. An adapter
   * MUST refuse (in dryRun/execute) any intent for which this returns false — a new/unapproved
   * target requires explicit Hart approval first (plan §9).
   */
  supportsTarget(target: StorageTarget): boolean;
}

/** Re-export for callers that describe a storage write's outcome without re-importing execution-adapter. */
export type StorageWriteOutcome = ExecutionOutcome;
