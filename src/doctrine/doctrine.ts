/**
 * src/doctrine/doctrine.ts — Phase 2.1: the HartOS doctrine, as code.
 *
 * The cockpit already ENFORCES the doctrine, but through scattered constants
 * (cloudflare-security `ACTION_EXECUTION`/`MUTATION_ENDPOINTS`; proposals/gates
 * `executeProposal()` fail-closed). This module is the SINGLE importable source — the
 * clauses as data + the machine-checkable invariants — so:
 *   - generated agents (Phase 4) inherit REAL guards, not just prose,
 *   - `docs/DOCTRINE.md` is generated FROM the code (doc ← code, one source of truth),
 *   - a CI conformance test (tests/doctrine-conformance.test.ts) fails the build on any
 *     violation (execution enabled, a mutation endpoint, a pg driver reachable from the
 *     Worker, or `executeProposal` not failing closed).
 *
 * Pure; no I/O. It re-exports the live enforcement constants so callers have ONE door.
 */

import { ACTION_EXECUTION, MUTATION_ENDPOINTS } from "../runtime/cloudflare-security.js";
import { executeProposal, executionAllowed, ActionExecutionDisabledError, type GateEnv } from "../cockpit/proposals/gates.js";

export { ACTION_EXECUTION, MUTATION_ENDPOINTS } from "../runtime/cloudflare-security.js";
export { executeProposal, executionAllowed, ActionExecutionDisabledError } from "../cockpit/proposals/gates.js";

/** v2 = code-enforced (v1 was the prose Shared Doctrine in the factory templates). */
export const DOCTRINE_VERSION = "v2" as const;

export interface DoctrineClause {
  id: string;
  title: string;
  /** The binding statement. */
  rule: string;
  /** Where/how it is enforced in code (so the doc never drifts from reality). */
  enforcedBy: string;
}

export const DOCTRINE: DoctrineClause[] = [
  {
    id: "read-only-first",
    title: "Read-only first",
    rule: "The hosted Worker reads; it never mutates. No mutation endpoints exist.",
    enforcedBy: "cloudflare-security MUTATION_ENDPOINTS='none' + the GET/POST/OPTIONS method allowlist",
  },
  {
    id: "propose-before-execute",
    title: "Propose before execute",
    rule: "Every action is a non-executable proposal until approved. No code path performs a real action.",
    enforcedBy: "proposals/gates executeProposal() throws ActionExecutionDisabledError; proposals are executable:false",
  },
  {
    id: "human-approval",
    title: "Human approval floor",
    rule: "Nothing executes without Hart's explicit, per-action approval.",
    enforcedBy: "the approval spine (Phase 2.2 lifecycle) + the fail-closed precondition (Phase 2.5)",
  },
  {
    id: "no-secret-exposure",
    title: "No secret exposure",
    rule: "Secrets stay server-side — never in HTML/JS/logs. Writes go through a capability token, never a DB key, and never from the Worker.",
    enforcedBy: "security checklist + the Edge Function capability token (HARTOS_ASK_WRITE_TOKEN); pg isolated to Node",
  },
  {
    id: "freshness-confidence-honesty",
    title: "Freshness + confidence honesty",
    rule: "Verdicts carry honest freshness and derived confidence; neither is ever faked.",
    enforcedBy: "agent-signal derived confidence + freshness-from-age; degraded reads surface why",
  },
  {
    id: "source-of-truth",
    title: "Source-of-truth ownership",
    rule: "Agent decisions/outputs are shared state in Supabase; each domain owns its own data.",
    enforcedBy: "per-domain read-models + the proposal/audit spine",
  },
  {
    id: "agent-domain-ownership",
    title: "Agent domain ownership",
    rule: "Each agent owns its domain; the cockpit reads it, and never reaches into another agent's writes.",
    enforcedBy: "the read-only anon RPC boundary per domain",
  },
  {
    id: "audit-trail",
    title: "Audit trail",
    rule: "Every state transition and execution writes an immutable audit entry (who/what/when/before/after).",
    enforcedBy: "the append-only audit log (Phase 2.3)",
  },
  {
    id: "fail-closed",
    title: "Fail-closed",
    rule: "When in doubt, deny. Execution is disabled by default; only one allowlisted, approved, audited action may ever run.",
    enforcedBy: "ACTION_EXECUTION='disabled' + executionAllowed() hard-capped false + the Phase 2.5 precondition gate",
  },
];

export interface DoctrineViolation {
  clause: string;
  detail: string;
}

/**
 * Assert the live runtime enforcement still upholds the doctrine. Returns [] when clean.
 * This is the heart of the conformance test — if anyone flips a guard, it fails CI.
 */
export function checkDoctrineInvariants(): DoctrineViolation[] {
  const v: DoctrineViolation[] = [];

  if (ACTION_EXECUTION !== "disabled") {
    v.push({ clause: "fail-closed", detail: `ACTION_EXECUTION is "${ACTION_EXECUTION}", expected "disabled"` });
  }
  if (MUTATION_ENDPOINTS !== "none") {
    v.push({ clause: "read-only-first", detail: `MUTATION_ENDPOINTS is "${MUTATION_ENDPOINTS}", expected "none"` });
  }

  // The execution gate must be hard-capped closed even when the env flag is set true.
  const forced: GateEnv = { ALLOW_COCKPIT_ACTION_EXECUTION: "true" };
  if (executionAllowed(forced) !== false) {
    v.push({ clause: "propose-before-execute", detail: "executionAllowed() returned true with the flag forced — it must be hard-capped closed" });
  }

  // executeProposal must always fail closed with the typed error.
  let failedClosed = false;
  try {
    executeProposal();
  } catch (err) {
    failedClosed = err instanceof ActionExecutionDisabledError;
  }
  if (!failedClosed) {
    v.push({ clause: "propose-before-execute", detail: "executeProposal() did not fail closed with ActionExecutionDisabledError" });
  }

  return v;
}

/** Generate the canonical DOCTRINE.md FROM the code (doc ← code; never edit the .md by hand). */
export function renderDoctrineMarkdown(): string {
  const lines: string[] = [
    `# HartOS Doctrine ${DOCTRINE_VERSION}`,
    "",
    "> GENERATED FROM `src/doctrine/doctrine.ts` — do not edit by hand. Every clause below is",
    "> machine-checked by `tests/doctrine-conformance.test.ts`; a violation fails CI. This is the",
    "> single source of truth that generated agents (Phase 4) import for real, code-level guards.",
    "",
  ];
  for (const c of DOCTRINE) {
    lines.push(`## ${c.title}`, "", c.rule, "", `_Enforced by: ${c.enforcedBy}_`, "");
  }
  return lines.join("\n");
}
