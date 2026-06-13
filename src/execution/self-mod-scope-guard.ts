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
  "src/llm/redaction.ts", // the secret detector post-verify relies on
];

export function isInSelfModScope(path: string): ScopeResult {
  const p = path.replace(/\\/g, "/").trim();
  if (p.includes("..")) {
    return { allowed: false, reason: "path escapes the source tree" };
  }
  if (/(^|\/)\.env/.test(p) || /secret/i.test(p) || p.endsWith(".key") || /wrangler[^/]*\.toml$/.test(p)) {
    return { allowed: false, reason: "secrets and deploy config are out of self-mod scope" };
  }
  if (p.startsWith("src/execution/adapters/")) {
    return { allowed: false, reason: "external mutation adapters are out of self-mod scope" };
  }
  if (SELF_PROTECTED_PREFIXES.some((prefix) => p.startsWith(prefix))) {
    return { allowed: false, reason: "self-mod may not edit its own guardrails (doctrine / self-mod guards / W3 hand+baseline / secret detector)" };
  }
  if (!p.startsWith("src/")) {
    return { allowed: false, reason: "only the project's own src/ runtime is in self-mod scope" };
  }
  return { allowed: true, reason: "in self-mod scope (own runtime)" };
}
