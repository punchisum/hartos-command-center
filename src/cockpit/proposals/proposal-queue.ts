/**
 * src/cockpit/proposals/proposal-queue.ts
 *
 * Phase 14B — LOCAL proposal queue. Persists proposal drafts as gitignored JSON
 * sidecars under cockpit-proposals/ so they survive past a single response.
 *
 * Local-only operations: save, list, read, reject, expire, mark
 * simulated-approved, append audit, dry-run. There is NO execute operation — the
 * only execution entry point (gates.executeProposal) fails closed. Files contain
 * no secrets (a secret check runs before every write); they are safe to inspect.
 */

import path from "node:path";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { containsSecret } from "../../llm/redaction.js";
import type { ActionProposal, ProposalAuditEvent, ProposalQueueItem, ProposalQueueStatus } from "./proposal-types.js";
import { EXECUTOR_ONLY_STATUSES } from "./proposal-types.js";
import { simulateProposal } from "./proposal-simulator.js";
import { type GateEnv } from "./gates.js";

export const DEFAULT_PROPOSAL_QUEUE_DIR = "cockpit-proposals";

/** A queue reference: a 1-based number (from `list`) or a full proposal id. */
export interface ProposalRef {
  number?: number;
  id?: string;
}

function queueDir(cwd: string): string {
  return path.join(cwd, DEFAULT_PROPOSAL_QUEUE_DIR);
}

/** Filenames must be filesystem-safe (ids contain ISO colons). */
function safeName(id: string): string {
  return id.replace(/[^a-zA-Z0-9._-]/g, "-");
}

function audit(event: string, at: string, detail?: string): ProposalAuditEvent {
  return detail ? { at, event, detail } : { at, event };
}

/** Convert a generated ActionProposal into a queue item. */
export function toQueueItem(proposal: ActionProposal, now: string): ProposalQueueItem {
  const status: ProposalQueueStatus = proposal.status === "pending_approval" ? "pending_approval" : "draft";
  return {
    ...proposal,
    status,
    updatedAt: now,
    auditEvents: [audit("created", now, `status=${status}`)],
  };
}

async function writeItem(cwd: string, item: ProposalQueueItem): Promise<void> {
  const json = JSON.stringify(item, null, 2);
  if (containsSecret(json)) {
    throw new Error("Refusing to write proposal: secret-looking content detected.");
  }
  await mkdir(queueDir(cwd), { recursive: true });
  await writeFile(path.join(queueDir(cwd), `${safeName(item.id)}.json`), json, "utf8");
}

/**
 * Save a generated proposal to the local queue. Degrades gracefully: returns
 * null if the queue dir cannot be written (caller keeps the response-only copy).
 */
export async function saveProposal(cwd: string, proposal: ActionProposal, now: string): Promise<ProposalQueueItem | null> {
  try {
    const item = toQueueItem(proposal, now);
    await writeItem(cwd, item);
    return item;
  } catch {
    return null;
  }
}

/** List saved proposals, newest first. Returns [] when storage is absent. */
export async function listProposals(cwd: string): Promise<ProposalQueueItem[]> {
  const dir = queueDir(cwd);
  if (!existsSync(dir)) return [];
  let files: string[];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const items: ProposalQueueItem[] = [];
  for (const f of files) {
    try {
      items.push(JSON.parse(await readFile(path.join(dir, f), "utf8")) as ProposalQueueItem);
    } catch {
      // skip unreadable/corrupt entry
    }
  }
  return items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

/** Read one proposal by exact id. */
export async function readProposal(cwd: string, id: string): Promise<ProposalQueueItem | null> {
  const file = path.join(queueDir(cwd), `${safeName(id)}.json`);
  if (!existsSync(file)) return null;
  try {
    return JSON.parse(await readFile(file, "utf8")) as ProposalQueueItem;
  } catch {
    return null;
  }
}

/** Resolve a number (1-based, newest first) or id to a stored item. */
export async function resolveRef(cwd: string, ref: ProposalRef): Promise<ProposalQueueItem | null> {
  if (ref.id) {
    const byId = await readProposal(cwd, ref.id);
    if (byId) return byId;
  }
  if (ref.number != null && ref.number >= 1) {
    const items = await listProposals(cwd);
    return items[ref.number - 1] ?? null;
  }
  return null;
}

async function update(cwd: string, ref: ProposalRef, mutate: (item: ProposalQueueItem) => void): Promise<ProposalQueueItem | null> {
  const item = await resolveRef(cwd, ref);
  if (!item) return null;
  mutate(item);
  await writeItem(cwd, item);
  return item;
}

/** Reject a proposal (local queue update only). */
export async function rejectProposal(cwd: string, ref: ProposalRef, now: string): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    item.status = "rejected";
    item.updatedAt = now;
    item.auditEvents.push(audit("rejected", now));
  });
}

/** Mark a proposal as simulated-approved (NOT executed). */
export async function markSimulatedApproved(cwd: string, ref: ProposalRef, now: string): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    item.status = "simulated_approved";
    item.updatedAt = now;
    item.auditEvents.push(audit("simulated_approved", now, "simulation only — no real execution"));
  });
}

// ─── Phase 17C/17D — two-key execution authorization (Key 1, cockpit-settable) ──

/** A durable spec id, distinct from the proposal id, that survives proposal expiry/rejection. */
export function deriveSpecId(item: ProposalQueueItem): string {
  return `spec-${safeName(item.id)}`;
}

/**
 * Phase 17C Key 1 — authorize the Node executor to act on this proposal.
 *
 * Transition: `simulated_approved → approved_for_execution`. This is the ONLY new state the
 * cockpit/Worker may set on the execution path; it assigns a durable `specId` (17C-5 / §11 Q2)
 * and records `executionAuthorizedAt` for age display (§11 Q3 — no auto-expiry). Authorization
 * ALONE creates nothing: real mutation also needs Key 2 (host gates) + the human-invoked Node
 * executor. `executeProposal()` still throws. Only transitions from `simulated_approved`; any
 * other current status is left unchanged with a denied audit event.
 */
export async function approveForExecution(cwd: string, ref: ProposalRef, now: string): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    if (item.status !== "simulated_approved") {
      item.updatedAt = now;
      item.auditEvents.push(
        audit("approve_for_execution_denied", now, `requires status=simulated_approved, was ${item.status}`)
      );
      return;
    }
    item.status = "approved_for_execution";
    item.specId = item.specId ?? deriveSpecId(item);
    item.executionAuthorizedAt = now;
    item.updatedAt = now;
    item.auditEvents.push(
      audit("approved_for_execution", now, `specId=${item.specId} — Key 1 only; needs host gates (Key 2) + Node executor`)
    );
  });
}

/**
 * Phase 17C §11 Q3 — explicitly revoke execution authorization (there is no auto-expiry).
 * Transition: `approved_for_execution → simulated_approved`. The durable `specId` is kept (it
 * outlives authorization); `executionAuthorizedAt` is cleared. Only transitions from
 * `approved_for_execution`; otherwise unchanged with a denied audit event.
 */
export async function revokeExecutionApproval(cwd: string, ref: ProposalRef, now: string): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    if (item.status !== "approved_for_execution") {
      item.updatedAt = now;
      item.auditEvents.push(
        audit("revoke_execution_denied", now, `requires status=approved_for_execution, was ${item.status}`)
      );
      return;
    }
    item.status = "simulated_approved";
    item.executionAuthorizedAt = null;
    item.updatedAt = now;
    item.auditEvents.push(audit("execution_authorization_revoked", now, "explicit revoke — authorization does not auto-expire"));
  });
}

/**
 * Phase 18D — advance to the terminal `runtime_provisioned` state. EXECUTOR-ONLY: this is called by
 * the Node runtime-provision orchestrator ONLY after every runtime step + the read-only smoke pass
 * (Hart's locked "advance on full success" decision). The cockpit/Worker can NEVER set this state.
 * Only transitions from `approved_for_execution`; any other current status is left unchanged with a
 * denied audit event. The durable `specId` is preserved.
 */
export async function markRuntimeProvisioned(
  cwd: string,
  ref: ProposalRef,
  now: string,
  detail?: string
): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    if (item.status !== "approved_for_execution") {
      item.updatedAt = now;
      item.auditEvents.push(
        audit("runtime_provisioned_denied", now, `requires status=approved_for_execution, was ${item.status}`)
      );
      return;
    }
    item.status = "runtime_provisioned";
    item.updatedAt = now;
    item.auditEvents.push(audit("runtime_provisioned", now, detail ?? "all runtime steps + smoke passed"));
  });
}

/**
 * Phase 1 (mutation go-live) — advance to the terminal `executed` state after a real write landed.
 * EXECUTOR-ONLY: called by the Node approved-proposal executor AFTER `dispatchMutation` actually
 * wrote (a non-null StateDelta). The cockpit/Worker can NEVER set this. Only transitions from
 * `approved_for_execution`; any other status is left unchanged with a denied audit event.
 */
export async function markExecuted(
  cwd: string,
  ref: ProposalRef,
  now: string,
  detail?: string
): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    if (item.status !== "approved_for_execution") {
      item.updatedAt = now;
      item.auditEvents.push(audit("executed_denied", now, `requires status=approved_for_execution, was ${item.status}`));
      return;
    }
    item.status = "executed";
    item.updatedAt = now;
    item.auditEvents.push(audit("executed", now, detail ?? "mutation dispatched + written"));
  });
}

/** Age (ms) of the current execution authorization, or null when not authorized. Pure. */
export function executionAuthorizationAgeMs(item: ProposalQueueItem, now: string): number | null {
  if (item.status !== "approved_for_execution" || !item.executionAuthorizedAt) return null;
  const age = Date.parse(now) - Date.parse(item.executionAuthorizedAt);
  return Number.isFinite(age) ? Math.max(0, age) : null;
}

/** Guard: assert a status is NOT an executor-only state before a cockpit/Worker-side write. */
export function assertCockpitSettableStatus(status: ProposalQueueStatus): void {
  if (EXECUTOR_ONLY_STATUSES.includes(status)) {
    throw new Error(`Status "${status}" is writable only by the Node execution host, never by the cockpit.`);
  }
}

/** Append a free-form audit event. */
export async function appendAudit(cwd: string, ref: ProposalRef, event: string, now: string, detail?: string): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    item.updatedAt = now;
    item.auditEvents.push(audit(event, now, detail));
  });
}

/** Expire proposals whose expiresAt has passed. Returns the count expired. */
export async function expireStaleProposals(cwd: string, now: string): Promise<number> {
  const items = await listProposals(cwd);
  let expired = 0;
  for (const item of items) {
    if (item.expiresAt && Date.parse(item.expiresAt) < Date.parse(now) && (item.status === "draft" || item.status === "pending_approval")) {
      item.status = "expired";
      item.updatedAt = now;
      item.auditEvents.push(audit("expired", now));
      await writeItem(cwd, item);
      expired += 1;
    }
  }
  return expired;
}

const ACTIVE: ProposalQueueStatus[] = ["draft", "pending_approval"];

export interface BulkRejectResult {
  count: number;
  items: ProposalQueueItem[];
}

/**
 * Phase 14B cleanup — reject all active (draft/pending) proposals, optionally
 * filtered by domain (e.g. "fitness"). LOCAL QUEUE ONLY. Never executes.
 */
export async function rejectAllDraftProposals(
  cwd: string,
  now: string,
  domain?: ProposalQueueItem["domain"]
): Promise<BulkRejectResult> {
  const items = await listProposals(cwd);
  const targets = items.filter(
    (i) => ACTIVE.includes(i.status) && (domain ? i.domain === domain : true)
  );
  const updated: ProposalQueueItem[] = [];
  for (const item of targets) {
    item.status = "rejected";
    item.updatedAt = now;
    item.auditEvents.push(audit("rejected", now, domain ? `bulk reject (${domain})` : "bulk reject"));
    try {
      await writeItem(cwd, item);
      updated.push(item);
    } catch {
      // skip unwritable entry; keep going
    }
  }
  return { count: updated.length, items: updated };
}

export interface ExpireDuplicatesResult {
  count: number;
  expired: ProposalQueueItem[];
}

/**
 * Phase 14B cleanup — expire OLDER duplicates among active proposals. Two
 * proposals are duplicates when domain + actionType + title match. The newest
 * (by createdAt) is kept active; older ones are expired. LOCAL QUEUE ONLY.
 */
export async function expireDuplicateProposals(cwd: string, now: string): Promise<ExpireDuplicatesResult> {
  const items = (await listProposals(cwd)).filter((i) => ACTIVE.includes(i.status));
  const groups = new Map<string, ProposalQueueItem[]>();
  for (const i of items) {
    const key = `${i.domain}|${i.actionType}|${i.title}`;
    const arr = groups.get(key) ?? [];
    arr.push(i);
    groups.set(key, arr);
  }
  const expired: ProposalQueueItem[] = [];
  for (const arr of groups.values()) {
    if (arr.length < 2) continue;
    // listProposals already sorts newest-first; keep [0], expire the rest.
    for (const item of arr.slice(1)) {
      item.status = "expired";
      item.updatedAt = now;
      item.auditEvents.push(audit("expired", now, "duplicate (kept newest)"));
      try {
        await writeItem(cwd, item);
        expired.push(item);
      } catch {
        // skip unwritable entry
      }
    }
  }
  return { count: expired.length, expired };
}

export interface ProposalHistory {
  total: number;
  draft: number;
  pending_approval: number;
  pending: number;
  simulated_approved: number;
  approved_for_execution: number;
  rejected: number;
  expired: number;
  active: number;
  latestActive: ProposalQueueItem[];
}

/** Phase 14B cleanup — read-only roll-up of queue status counts. Never executes. */
export async function proposalHistory(cwd: string): Promise<ProposalHistory> {
  const items = await listProposals(cwd);
  const count = (s: ProposalQueueStatus) => items.filter((i) => i.status === s).length;
  const draft = count("draft");
  const pending_approval = count("pending_approval");
  const active = draft + pending_approval;
  return {
    total: items.length,
    draft,
    pending_approval,
    pending: active,
    simulated_approved: count("simulated_approved"),
    approved_for_execution: count("approved_for_execution"),
    rejected: count("rejected"),
    expired: count("expired"),
    active,
    latestActive: items.filter((i) => ACTIVE.includes(i.status)).slice(0, 5),
  };
}

/** Run a dry-run simulation on a stored proposal (NEVER executes). */
export async function dryRunProposalInQueue(cwd: string, ref: ProposalRef, now: string, env: GateEnv = process.env): Promise<ProposalQueueItem | null> {
  return update(cwd, ref, (item) => {
    item.dryRunResult = simulateProposal(item as unknown as ActionProposal, env);
    item.updatedAt = now;
    item.auditEvents.push(audit("dry_run", now, "simulation only — execution disabled"));
  });
}
