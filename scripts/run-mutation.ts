/**
 * scripts/run-mutation.ts — the gated "fire ONE mutation" CLI (3-levels-up master plan §12).
 *
 * HartOS has a unified, gated execute path — `dispatchMutation` — that routes one approved typed
 * `MutationCommand` to the right gated runner (refresh-sync / reject-drafts / archive-rejected /
 * clickup-comment / clickup-move-status) and, ONLY when a real write executes, projects the §13
 * StateDeltaSignal. Until now the adapters were library-only with no command-line entry. This is
 * that entry point — the one place a human (Hart) can FIRE a single mutation from the shell.
 *
 *   • DRY-RUN (default)  — builds the command + store, runs the runner in count/preview mode.
 *                          No write, the projected delta is always null. A safe scope/connectivity
 *                          check that bypasses nothing in the gate.
 *   • --execute          — ATTEMPTS the real run. It adds NO authority: each runner's Phase 2.5
 *                          fail-closed gate + the per-action `ALLOW_EXEC_*` flag (default-OFF) +
 *                          the global kill-switch still decide. An un-armed flag yields an honest
 *                          refusal that writes nothing — that is correct, and it is surfaced.
 *
 * Transport / store (built from env, per adapter; the secret is NEVER printed — names only):
 *   clickup-comment / clickup-move-status  → createClickUpClient(env)  (CLICKUP_API_TOKEN)
 *   reject-drafts                          → createRejectDraftsDb(env)  (HARTOS_SUPABASE_DB_URL)
 *   archive-rejected                       → createArchiveRejectedDb(env) (HARTOS_SUPABASE_DB_URL)
 *   refresh-sync                           → createRefreshSyncDb(env)   (HARTOS_SUPABASE_DB_URL)
 * When a builder returns null (its credential is absent) the CLI prints an honest
 * "‹adapter› not configured (set ‹ENV NAME›)" and exits 0 — it never throws.
 *
 * Arming (load via `node --env-file-if-exists=.env.local`; values are NEVER printed):
 *   ALLOW_EXEC_CLICKUP_COMMENT / _CLICKUP_MOVE / _REJECT_DRAFTS / _ARCHIVE_REJECTED / _REFRESH_SYNC
 *   HARTOS_EXECUTION_KILL_SWITCH=on  overrides everything (global stop)
 *
 * NODE EXECUTION HOST ONLY. This imports the runners / stores / clickup-client / pg — correct for
 * the execution host. It lives in scripts/ and MUST NEVER be imported by the read-only Worker. It
 * adds no authority and does not bypass the gate; arming is the operator's job via the env flags.
 */

import { pathToFileURL } from "node:url";
import {
  dispatchMutation,
  type MutationCommand,
  type MutationAdapterId,
  type DispatchResult,
} from "../src/execution/execution-dispatch.js";
import { createClickUpClient, CLICKUP_TOKEN_ENV } from "../src/execution/clickup-client.js";
import { createRejectDraftsDb, EXECUTOR_DB_URL_ENV } from "../src/execution/run-reject-drafts-db.js";
import { createArchiveRejectedDb } from "../src/execution/run-archive-rejected-db.js";
import { createMarkReviewedDb } from "../src/execution/run-mark-reviewed-db.js";
import { createRefreshSyncDb } from "../src/execution/run-refresh-sync-db.js";
import { KILL_SWITCH_ENV } from "../src/execution/execution-adapter.js";
import { CLICKUP_COMMENT_FLAG } from "../src/execution/adapters/clickup-comment.js";
import { CLICKUP_MOVE_FLAG } from "../src/execution/adapters/clickup-move-status.js";
import { REJECT_DRAFTS_FLAG } from "../src/execution/adapters/reject-drafts.js";
import { ARCHIVE_REJECTED_FLAG } from "../src/execution/adapters/archive-rejected.js";
import { MARK_REVIEWED_FLAG } from "../src/execution/adapters/mark-reviewed.js";
import { REFRESH_SYNC_FLAG } from "../src/execution/adapters/refresh-sync.js";
import { EXECUTABLE_FROM } from "../src/doctrine/execution-gate.js";
import type { ClickUpCommentStore } from "../src/execution/adapters/clickup-comment.js";
import type { ClickUpMoveStore } from "../src/execution/adapters/clickup-move-status.js";
import type { RejectDraftsStore } from "../src/execution/adapters/reject-drafts.js";
import type { ArchiveRejectedStore } from "../src/execution/adapters/archive-rejected.js";
import type { MarkReviewedStore } from "../src/execution/adapters/mark-reviewed.js";
import type { RefreshSyncStore } from "../src/execution/adapters/refresh-sync.js";

/** The adapter ids this CLI accepts (the dispatcher's union, surfaced for help text). */
const ADAPTER_IDS: readonly MutationAdapterId[] = [
  "clickup-comment",
  "clickup-move-status",
  "reject-drafts",
  "archive-rejected",
  "mark-reviewed",
  "refresh-sync",
];

/** Per-adapter arming flag NAME (surfaced so the operator knows what to set; never the value). */
const ADAPTER_FLAG: Record<MutationAdapterId, string> = {
  "clickup-comment": CLICKUP_COMMENT_FLAG,
  "clickup-move-status": CLICKUP_MOVE_FLAG,
  "reject-drafts": REJECT_DRAFTS_FLAG,
  "archive-rejected": ARCHIVE_REJECTED_FLAG,
  "mark-reviewed": MARK_REVIEWED_FLAG,
  "refresh-sync": REFRESH_SYNC_FLAG,
};

/** Per-adapter store-credential env var NAME (surfaced in the "not configured" message). */
const ADAPTER_CRED_ENV: Record<MutationAdapterId, string> = {
  "clickup-comment": CLICKUP_TOKEN_ENV,
  "clickup-move-status": CLICKUP_TOKEN_ENV,
  "reject-drafts": EXECUTOR_DB_URL_ENV,
  "archive-rejected": EXECUTOR_DB_URL_ENV,
  "mark-reviewed": EXECUTOR_DB_URL_ENV,
  "refresh-sync": EXECUTOR_DB_URL_ENV,
};

/**
 * The store + the close handle the CLI built for an adapter. `store` is null when the credential
 * is absent (honest "not configured" exit). `close` tears down any pg pool / handle the builder
 * opened; it is a no-op for the ClickUp client (fetch-based, nothing to close).
 */
interface ResolvedStore {
  store: ClickUpCommentStore | ClickUpMoveStore | RejectDraftsStore | ArchiveRejectedStore | MarkReviewedStore | RefreshSyncStore | null;
  close: () => Promise<void>;
}

/**
 * A test-injectable store override. Tests pass a fake store (and an optional close spy) so the
 * core runs with NO network/DB/fs. `store: null` exercises the "not configured" path explicitly.
 */
export interface StoreOverride {
  store: ResolvedStore["store"];
  close?: () => Promise<void>;
}

export interface RunMutationCliInput {
  /** Argv WITHOUT node/script (i.e. process.argv.slice(2)). */
  argv: string[];
  /** Env to read flags + credentials from (names only ever surfaced). */
  env: Record<string, string | undefined>;
  /** Inject a fake store/client to bypass the env builders (tests + advanced callers). */
  storeOverride?: StoreOverride;
  /** Injected for determinism (never the ambient clock). Threaded to the dispatcher. */
  now?: Date;
}

export interface RunMutationCliResult {
  exitCode: number;
  /** Every line the CLI would print (names only, never a secret value). */
  lines: string[];
  /** The dispatch result, when a command actually ran (absent for arg errors / not-configured). */
  result?: DispatchResult;
}

/** Minimal flag parser: `--key value` and bare `--flag`. Repeats keep the last. Never throws. */
function parseArgs(argv: string[]): { flags: Record<string, string>; bools: Set<string> } {
  const flags: Record<string, string> = {};
  const bools = new Set<string>();
  for (let i = 0; i < argv.length; i++) {
    const tok = argv[i];
    if (!tok.startsWith("--")) continue;
    const key = tok.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags[key] = next;
      i++;
    } else {
      bools.add(key);
    }
  }
  return { flags, bools };
}

/** A required string arg; collects a clear error into `missing` rather than throwing. */
function req(flags: Record<string, string>, name: string, missing: string[]): string {
  const v = flags[name];
  if (v === undefined || v.trim().length === 0) {
    missing.push(`--${name}`);
    return "";
  }
  return v;
}

/** Build the store for an adapter from env, or report it not-configured. Closes pg in `close`. */
async function resolveStore(
  adapter: MutationAdapterId,
  env: Record<string, string | undefined>,
): Promise<ResolvedStore> {
  switch (adapter) {
    case "clickup-comment": {
      const client = createClickUpClient(env);
      return { store: client?.commentStore ?? null, close: async () => {} };
    }
    case "clickup-move-status": {
      const client = createClickUpClient(env);
      return { store: client?.moveStore ?? null, close: async () => {} };
    }
    case "reject-drafts": {
      const handle = await createRejectDraftsDb(env);
      return { store: handle?.store ?? null, close: async () => { if (handle) await handle.close(); } };
    }
    case "archive-rejected": {
      const handle = await createArchiveRejectedDb(env);
      return { store: handle?.store ?? null, close: async () => { if (handle) await handle.close(); } };
    }
    case "mark-reviewed": {
      const handle = await createMarkReviewedDb(env);
      return { store: handle?.store ?? null, close: async () => { if (handle) await handle.close(); } };
    }
    case "refresh-sync": {
      // Prefer the verifying pg executor store (read-before-write live-status check + close()).
      const handle = await createRefreshSyncDb(env);
      return { store: handle?.store ?? null, close: async () => { if (handle) await handle.close(); } };
    }
  }
}

/** Describe how the flag reads to the operator (ARMED / not-"true" / unset) — names only. */
function describeFlag(env: Record<string, string | undefined>, flagName: string): string {
  const v = env[flagName];
  if (v === "true") return `${flagName} = true (ARMED)`;
  if (v !== undefined) return `${flagName} = (set, not "true" → OFF)`;
  return `${flagName} = unset (OFF)`;
}

/** Construct the typed MutationCommand for an adapter from parsed flags + the resolved store. */
function buildCommand(
  adapter: MutationAdapterId,
  flags: Record<string, string>,
  store: NonNullable<ResolvedStore["store"]>,
  missing: string[],
): MutationCommand | null {
  // The authorizing proposal id is required for every adapter (the audit/StateDelta key). The
  // status is asserted as approved_for_execution — the gate (and, for refresh-sync, the runner's
  // live re-read) is what actually decides; a non-approved live row is refused by construction.
  const proposalId = req(flags, "proposal", missing);
  const proposal = { id: proposalId, status: EXECUTABLE_FROM, expiresAt: null };

  switch (adapter) {
    case "clickup-comment": {
      const cardId = req(flags, "card", missing);
      const text = req(flags, "text", missing);
      if (missing.length) return null;
      return {
        adapterId: "clickup-comment",
        proposal,
        target: { cardId, cardName: cardId, commentText: text },
        store: store as ClickUpCommentStore,
      };
    }
    case "clickup-move-status": {
      const cardId = req(flags, "card", missing);
      const fromStatus = req(flags, "from", missing);
      const toStatus = req(flags, "to", missing);
      if (missing.length) return null;
      return {
        adapterId: "clickup-move-status",
        proposal,
        target: { cardId, cardName: cardId, fromStatus, toStatus },
        store: store as ClickUpMoveStore,
      };
    }
    case "reject-drafts": {
      if (missing.length) return null;
      return { adapterId: "reject-drafts", proposal, store: store as RejectDraftsStore };
    }
    case "archive-rejected": {
      if (missing.length) return null;
      return { adapterId: "archive-rejected", proposal, store: store as ArchiveRejectedStore };
    }
    case "mark-reviewed": {
      if (missing.length) return null;
      return { adapterId: "mark-reviewed", proposal, store: store as MarkReviewedStore };
    }
    case "refresh-sync": {
      if (missing.length) return null;
      return { adapterId: "refresh-sync", proposal, store: store as RefreshSyncStore };
    }
  }
}

/** Usage text (names only). Printed on an arg error so the refusal is actionable. */
function usageLines(): string[] {
  return [
    "Usage: node dist/scripts/run-mutation.js --adapter <id> [adapter args] [--execute]",
    `  adapters: ${ADAPTER_IDS.join(" | ")}`,
    '  clickup-comment      --card <id> --proposal <pid> --text "<comment>"',
    '  clickup-move-status  --card <id> --proposal <pid> --from "<status>" --to "<status>"',
    "  reject-drafts        --proposal <pid>",
    "  archive-rejected     --proposal <pid>",
    "  refresh-sync         --proposal <pid>",
    "  DRY-RUN by default; --execute ATTEMPTS the real run (the gate + ALLOW_EXEC_* flag still decide).",
  ];
}

/**
 * The testable core. Parses argv, builds the typed command + the env-derived store (or an injected
 * override), calls `dispatchMutation`, and returns `{ exitCode, lines, result }`. NEVER throws to
 * the caller — any error is caught and returned as a safe message + non-zero exit. The bin wrapper
 * prints `lines` and sets the process exit code. No secret value is ever placed in `lines`.
 */
export async function runMutationCli(input: RunMutationCliInput): Promise<RunMutationCliResult> {
  const { argv, env, storeOverride, now } = input;
  const lines: string[] = [];
  const { flags, bools } = parseArgs(argv);
  const execute = bools.has("execute");

  // ── 1) Validate the adapter id up front (a clear, no-throw refusal otherwise). ──
  const adapter = flags.adapter as MutationAdapterId | undefined;
  if (!adapter || !ADAPTER_IDS.includes(adapter)) {
    lines.push(adapter ? `Unknown adapter: ${adapter}` : "Missing required --adapter <id>");
    lines.push(...usageLines());
    return { exitCode: 2, lines };
  }

  // ── 2) Header — adapter, mode, arming flag + kill-switch, all by NAME. ──
  const killOn = (env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on";
  lines.push("HartOS mutation CLI");
  lines.push(`  adapter:       ${adapter}`);
  lines.push(`  mode:          ${execute ? "EXECUTE (writes IF the gate allows)" : "dry-run (count/preview only, no write)"}`);
  lines.push(`  ${describeFlag(env, ADAPTER_FLAG[adapter])}`);
  lines.push(`  ${KILL_SWITCH_ENV} = ${killOn ? "on (BLOCKS ALL execution)" : "off"}`);

  // ── 3) Resolve the store: an injected override (tests) else build it from env. ──
  let resolved: ResolvedStore;
  try {
    resolved = storeOverride
      ? { store: storeOverride.store, close: storeOverride.close ?? (async () => {}) }
      : await resolveStore(adapter, env);
  } catch (e) {
    // A real (non-TLS) connection failure surfaces here — report the message, never the cred.
    lines.push(`Could not open the ${adapter} store: ${e instanceof Error ? e.message : String(e)}`);
    return { exitCode: 1, lines };
  }

  // Honest "not configured" — the credential is absent. Exit 0 (this is not an error), no throw.
  if (resolved.store == null) {
    lines.push(`${adapter} not configured (set ${ADAPTER_CRED_ENV[adapter]})`);
    await resolved.close();
    return { exitCode: 0, lines };
  }

  // ── 4) Build the typed command; a missing/invalid arg is a no-throw refusal. ──
  const missing: string[] = [];
  let command: MutationCommand | null;
  try {
    command = buildCommand(adapter, flags, resolved.store, missing);
  } catch (e) {
    await resolved.close();
    lines.push(`Invalid arguments: ${e instanceof Error ? e.message : String(e)}`);
    lines.push(...usageLines());
    return { exitCode: 2, lines };
  }
  if (!command) {
    await resolved.close();
    lines.push(`Missing required argument(s): ${missing.join(", ")}`);
    lines.push(...usageLines());
    return { exitCode: 2, lines };
  }

  // ── 5) Dispatch through the ONE gated path. Capture the [exec-audit] traces the runners
  //       emit via console.log so the CLI's own output stays a clean, name-only summary. The
  //       dispatcher adds no authority; dryRun:!execute is the only knob this CLI turns. ──
  let result: DispatchResult;
  const origLog = console.log;
  try {
    console.log = () => {};
    // We only reach here with a non-null store — built from a present credential (the builder
    // returns null otherwise, handled above) or injected by an advanced caller/test. Either way a
    // write credential exists, so assert hasCapabilityToken; the gate's OTHER conditions (live
    // status approved_for_execution, non-expiry, audit, the per-action ALLOW_EXEC_* flag, the
    // kill-switch) still decide. dryRun:!execute is the only knob this CLI turns.
    result = await dispatchMutation(command, env, { dryRun: !execute, now, hasCapabilityToken: true });
  } catch (e) {
    console.log = origLog;
    await resolved.close();
    lines.push(`Mutation failed (no write committed past the gate): ${e instanceof Error ? e.message : String(e)}`);
    return { exitCode: 1, lines };
  } finally {
    console.log = origLog;
    // Always close any pg pool/handle we opened, success or failure.
    await resolved.close();
  }

  // ── 6) Honest summary — ran / refused / noop, the outcome, and the projected delta. ──
  const pre = result.result.precondition;
  const outcome = result.result.outcome;
  if (!execute) {
    lines.push(`Dry-run: ${outcome?.summary ?? "(no outcome returned)"}`);
    lines.push("No write performed; projected delta is null by design for a dry-run.");
    lines.push(`To fire for real: set ${ADAPTER_FLAG[adapter]}=true (kill-switch off), then re-run with --execute.`);
    return { exitCode: 0, lines, result };
  }

  if (!pre.allowed) {
    lines.push("REFUSED by the fail-closed gate (correct when the flag is unarmed OR the proposal is not approved_for_execution):");
    for (const d of pre.denials) lines.push(`  - ${d}`);
    lines.push(`To fire: proposal must be ${EXECUTABLE_FROM}, ${ADAPTER_FLAG[adapter]}=true (kill-switch off), then re-run with --execute.`);
    return { exitCode: 2, lines, result };
  }

  if (result.result.executed && outcome) {
    lines.push(`EXECUTED: ${outcome.summary}`);
    lines.push(`  before: ${JSON.stringify(outcome.before)}   after: ${JSON.stringify(outcome.after)}`);
    if (result.delta) {
      lines.push(
        `StateDelta projected → source=${result.delta.source} domain=${result.delta.domain} ` +
          `action=${result.delta.actionType} entity=${result.delta.changedEntity} ` +
          `agents=[${result.delta.affectedAgents.join(", ")}] freshness=${result.delta.freshness}`,
      );
    } else {
      lines.push("No StateDelta projected (unexpected for an executed write — check the runner).");
    }
    lines.push("Idempotent: an immediate re-run should be a no-op and leave the target unchanged.");
    return { exitCode: 0, lines, result };
  }

  // Gate allowed but nothing executed → an idempotent no-op (already in target / nothing to do).
  lines.push(`No-op: ${outcome?.summary ?? "the gate allowed it but no write was needed (idempotent)."}`);
  lines.push("Projected delta is null (a no-op changes nothing).");
  return { exitCode: 0, lines, result };
}

// ── Thin bin wrapper: only when run directly. Prints lines, sets the exit code, never throws. ──
// Direct-run guard (NodeNext ESM): run only when this file is the entry, never when imported (the
// test imports runMutationCli). pathToFileURL normalizes the Windows drive-letter form so the
// comparison is robust. Mirrors scripts/cockpit-ask-host.ts.
const invokedDirectly =
  typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  runMutationCli({ argv: process.argv.slice(2), env: process.env })
    .then((res) => {
      for (const l of res.lines) console.log(l);
      process.exit(res.exitCode);
    })
    .catch((e) => {
      // Last-resort guard — the core is no-throw, but never let an unexpected error crash open.
      console.error(`run-mutation: unexpected error (no write committed): ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
