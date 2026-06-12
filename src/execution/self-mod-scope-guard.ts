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
  if (!p.startsWith("src/")) {
    return { allowed: false, reason: "only the project's own src/ runtime is in self-mod scope" };
  }
  return { allowed: true, reason: "in self-mod scope (own runtime)" };
}
