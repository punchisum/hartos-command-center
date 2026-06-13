/**
 * src/execution/self-mod-post-verify.ts — Phase 6: the post-modification safety gate (PURE).
 *
 * After a self-mod run edits the working tree, decide whether the change is SAFE TO KEEP. Fail-closed:
 * the verdict is ok ONLY if every changed path is in self-mod scope (isInSelfModScope) AND no diff
 * content leaks a secret (containsSecret). A non-ok verdict is the executor's signal to roll back.
 *
 * NOTE: "doctrine still holds + tests pass" is deliberately NOT checked here — checkDoctrineInvariants()
 * reads the already-loaded runtime, not the on-disk diff, so that guarantee belongs to the executor
 * running the test suite as a fresh subprocess. This gate is the pure, in-process half. No git/fs/process.
 */
import { isInSelfModScope } from "./self-mod-scope-guard.js";
import { containsSecret } from "../llm/redaction.js";

export interface SelfModViolation {
  kind: "out-of-scope" | "secret-leak";
  detail: string;
}

export interface PostVerifyResult {
  ok: boolean;
  violations: SelfModViolation[];
}

/** Decide whether a completed self-mod edit (its changed files + unified diff text) is safe to keep. */
export function postVerifySelfMod(changedFiles: string[], diffText: string): PostVerifyResult {
  const violations: SelfModViolation[] = [];

  for (const file of changedFiles) {
    const scope = isInSelfModScope(file);
    if (!scope.allowed) {
      violations.push({ kind: "out-of-scope", detail: `${file}: ${scope.reason}` });
    }
  }

  if (containsSecret(diffText)) {
    violations.push({ kind: "secret-leak", detail: "the diff contains a secret-shaped token" });
  }

  return { ok: violations.length === 0, violations };
}
