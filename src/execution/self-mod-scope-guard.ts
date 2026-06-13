/**
 * src/execution/self-mod-scope-guard.ts — Phase 6: the allow/deny boundary for what autonomous
 * self-modification may touch. Fail-closed: a path is in scope ONLY if it is the project's own
 * runtime source and is not a secret, deploy config, or an external mutation adapter (anything
 * whose change could leave the fence). Everything else is denied. PURE.
 */

export interface ScopeResult {
  allowed: boolean;
  reason: string;
}

/**
 * SELF-PROTECTION: the machinery that fences, executes, or audits self-mod is OUT of scope. If a
 * self-mod could edit any of these, it could weaken its own restraints and the SAME run's post-verify
 * would then clear the (now-unguarded) change. Prefix/exact match against the normalised path.
 */
const SELF_PROTECTED_PREFIXES = [
  "src/doctrine/", // the fence: invariants, execution-gate, amendment-gate
  "src/execution/self-mod-", // the self-mod guards + verifiers + (future) executor/rollback
  "src/execution/claude-exec-", // the W3 baseline + tool-scope the run + rollback depend on
  "src/execution/claude-task-executor", // the W3 hand that performs the edit
  // the gated dispatch / verification / audit spine — "executes or audits" self-mod:
  "src/execution/execution-verification", // P3 "did the change land" verifier + its audit
  "src/execution/execution-adapter", // the action allowlist + ALLOW_EXEC gating
  "src/execution/execution-dispatch", // the gated dispatch spine
  "src/execution/approved-executor", // the approved-proposal executor
  "src/execution/rollback-executor", // the rollback execution core
  "src/execution/audit-tail", // the append-only audit read
  "src/llm/redaction.ts", // the secret detector post-verify relies on
]; // NOTE: prefixes are lowercase; matching is case-folded (see lp below).

export function isInSelfModScope(path: string): ScopeResult {
  const p = path.replace(/\\/g, "/").trim();
  // Case-fold the DENY checks: a case-insensitive filesystem (the Windows daemon) aliases
  // "src/Doctrine/…" to the real file, and `git status` reports an untracked path's verbatim
  // casing — so a case variant must NOT slip a guardrail edit past the fence. Matching lowercase
  // only ever DENIES MORE (fail-closed); the in-scope allow-gate below stays case-exact so a
  // non-canonical-case path falls through to denied rather than being wrongly allowed.
  const lp = p.toLowerCase();
  if (p.includes("..")) {
    return { allowed: false, reason: "path escapes the source tree" };
  }
  if (/(^|\/)\.env/.test(lp) || /secret/.test(lp) || lp.endsWith(".key") || /wrangler[^/]*\.toml$/.test(lp)) {
    return { allowed: false, reason: "secrets and deploy config are out of self-mod scope" };
  }
  if (lp.startsWith("src/execution/adapters/")) {
    return { allowed: false, reason: "external mutation adapters are out of self-mod scope" };
  }
  if (SELF_PROTECTED_PREFIXES.some((prefix) => lp.startsWith(prefix))) {
    return { allowed: false, reason: "self-mod may not edit its own guardrails (doctrine / dispatch+verify+audit spine / self-mod machinery / secret detector)" };
  }
  if (!p.startsWith("src/")) {
    return { allowed: false, reason: "only the project's own src/ runtime is in self-mod scope" };
  }
  return { allowed: true, reason: "in self-mod scope (own runtime)" };
}
