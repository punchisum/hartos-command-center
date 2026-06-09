/**
 * src/research/boundary-gate.ts
 *
 * Plan §7 — the per-job boundary gate. A SEPARATE, PURE check from the single
 * execution gate (../doctrine/execution-gate.ts). It does NOT replace, fork, or
 * weaken that gate: the execution gate decides whether an approved, allowlisted,
 * audited action MAY run at all; this gate decides whether a job's *measured usage*
 * is still inside its declared BoundaryDefinition. Both must hold.
 *
 * It mirrors the execution gate's `{ allowed, denials[] }` shape on purpose so callers
 * reason about both the same way. Fail-closed by construction:
 *   - undefined numeric ceilings (maxTime/maxCost/maxSearchDepth/maxFilesWritten) mean
 *     "no explicit limit" and are not checked;
 *   - undefined permission flags (externalNetworkAllowed/llmAllowed) DENY the capability —
 *     a job must explicitly declare it may reach the network / call an LLM.
 *
 * Pure: no I/O. The caller measures usage (reads/clocks) and passes it in.
 */

import type { BoundaryDefinition } from "./agent-job-types.js";

/** Measured, controlled usage for a job at a decision point. Caller-supplied; no I/O here. */
export interface BoundaryUsage {
  /** Wall-clock elapsed so far, in ms. */
  elapsedTime?: number;
  /** Spend incurred so far (same cost units as maxCost). */
  cost?: number;
  /** Deepest search/recursion reached so far. */
  searchDepth?: number;
  /** Number of artifact files written (or about to be written) so far. */
  filesWritten?: number;
  /** Sources the job has used / intends to use this step. */
  sourcesUsed?: string[];
  /** True if this step would reach the external network. */
  usesExternalNetwork?: boolean;
  /** True if this step would call an LLM. */
  usesLlm?: boolean;
}

/** Mirrors the execution gate's result shape: empty `denials` iff allowed. */
export interface BoundaryCheckResult {
  allowed: boolean;
  /** Every violated boundary is named (fail-closed, fully explained). */
  denials: string[];
}

/** Case-insensitive membership against a denylist/allowlist of source names. */
function matchesAny(source: string, list: readonly string[]): boolean {
  const s = source.trim().toLowerCase();
  return list.some((entry) => entry.trim().toLowerCase() === s);
}

/**
 * The pure boundary check. Returns `{ allowed:true, denials:[] }` only when measured
 * usage is within EVERY declared boundary; otherwise lists every reason it refused.
 *
 * A job whose usage exceeds maxTime/maxCost/maxSearchDepth/maxFilesWritten, uses a
 * disallowed source (or a source outside a declared allowlist), or violates
 * externalNetworkAllowed/llmAllowed is refused — never silently run.
 */
export function checkBoundary(usage: BoundaryUsage, boundary: BoundaryDefinition): BoundaryCheckResult {
  const denials: string[] = [];

  if (boundary.maxTime !== undefined && usage.elapsedTime !== undefined && usage.elapsedTime > boundary.maxTime) {
    denials.push(`maxTime exceeded: ${usage.elapsedTime}ms > ${boundary.maxTime}ms`);
  }
  if (boundary.maxCost !== undefined && usage.cost !== undefined && usage.cost > boundary.maxCost) {
    denials.push(`maxCost exceeded: ${usage.cost} > ${boundary.maxCost}`);
  }
  if (boundary.maxSearchDepth !== undefined && usage.searchDepth !== undefined && usage.searchDepth > boundary.maxSearchDepth) {
    denials.push(`maxSearchDepth exceeded: ${usage.searchDepth} > ${boundary.maxSearchDepth}`);
  }
  if (boundary.maxFilesWritten !== undefined && usage.filesWritten !== undefined && usage.filesWritten > boundary.maxFilesWritten) {
    denials.push(`maxFilesWritten exceeded: ${usage.filesWritten} > ${boundary.maxFilesWritten}`);
  }

  const sources = usage.sourcesUsed ?? [];
  const disallowed = boundary.disallowedSources ?? [];
  const allowlist = boundary.allowedSources ?? [];
  for (const source of sources) {
    // Denylist always wins.
    if (disallowed.length > 0 && matchesAny(source, disallowed)) {
      denials.push(`disallowed source used: "${source}"`);
      continue;
    }
    // A declared positive allowlist means everything not on it is refused.
    if (allowlist.length > 0 && !matchesAny(source, allowlist)) {
      denials.push(`source "${source}" is not on the allowed-sources allowlist`);
    }
  }

  // Permission flags fail closed: undefined ⇒ capability denied.
  if (usage.usesExternalNetwork && boundary.externalNetworkAllowed !== true) {
    denials.push("external network not permitted by boundary (externalNetworkAllowed is not true)");
  }
  if (usage.usesLlm && boundary.llmAllowed !== true) {
    denials.push("LLM use not permitted by boundary (llmAllowed is not true)");
  }

  return { allowed: denials.length === 0, denials };
}
