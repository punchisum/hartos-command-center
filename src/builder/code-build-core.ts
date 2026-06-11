/**
 * src/builder/code-build-core.ts — the verify-looped code-build control plane (T5, EXPERIMENTAL).
 *
 * HartOS has no code-writing brain today: Beezulbub's pack-implement bodies literally
 * `throw new Error("not implemented")`. The HARD, valuable part of building one safely is not the
 * LLM call — it's the DISCIPLINE around it: generate → VERIFY (typecheck/test) → on failure feed the
 * errors back and retry, and ACCEPT ONLY on a green verify, never merging blindly. This module is
 * exactly that control loop, and nothing more:
 *
 *   - Gated by TWO keys (ALLOW_CODE_BUILD + CONFIRM_CODE_BUILD); disarmed by default ⇒ generates
 *     nothing, returns an honest dry result.
 *   - Bounded retries; each retry receives the prior attempt's verify errors (self-correction).
 *   - Returns "verified" ONLY when the verifier passed; otherwise "failed" with the artifact WITHHELD
 *     (status failed) — it never claims success on unverified code.
 *   - It NEVER writes to disk and NEVER merges. It returns the candidate files; the caller decides
 *     whether to write them to a review artifact (never into the repo, never auto-integrated).
 *
 * Pure over an injected generator + verifier, so the loop logic is fully unit-tested. The real LLM
 * generator + the real `tsc --noEmit` verifier are wired in scripts/code-build.ts. Honest v1: raw
 * multi-file generation fidelity depends on the provider; this plane guarantees only that nothing
 * unverified is ever presented as built.
 */

export const CODE_BUILD_FLAG = "ALLOW_CODE_BUILD";
export const CODE_BUILD_CONFIRM = "CONFIRM_CODE_BUILD";

export interface GeneratedFile {
  path: string;
  content: string;
}

export interface GenerateInput {
  request: string;
  attempt: number;
  /** The prior attempt's verify errors, fed back so the generator can self-correct. */
  priorErrors: string[];
}

export type CodeGenerator = (input: GenerateInput) => Promise<{ files: GeneratedFile[]; notes?: string }>;

export interface VerifyResult {
  ok: boolean;
  errors: string[];
}

export type Verifier = (files: GeneratedFile[]) => Promise<VerifyResult>;

export interface CodeBuildInput {
  request: string;
  generate: CodeGenerator;
  verify: Verifier;
  env: Record<string, string | undefined>;
  /** Max generate→verify attempts (default 3). */
  maxAttempts?: number;
}

export type CodeBuildStatus = "verified" | "failed" | "disarmed" | "empty";

export interface CodeBuildResult {
  status: CodeBuildStatus;
  attempts: number;
  /** The candidate files: the GREEN set on "verified"; the last (rejected) set on "failed". */
  files: GeneratedFile[];
  /** The last verify errors (non-empty on "failed"). */
  errors: string[];
  lines: string[];
}

/** Twice-armed: BOTH the class flag and the confirm flag must be "true". Default OFF. */
export function codeBuildArmed(env: Record<string, string | undefined>): boolean {
  const on = (k: string) => String(env[k] ?? "").trim().toLowerCase() === "true";
  return on(CODE_BUILD_FLAG) && on(CODE_BUILD_CONFIRM);
}

export async function runCodeBuild(input: CodeBuildInput): Promise<CodeBuildResult> {
  const { request, generate, verify, env } = input;
  const maxAttempts = Math.max(1, input.maxAttempts ?? 3);
  const lines: string[] = [];

  if (!request.trim()) {
    return { status: "empty", attempts: 0, files: [], errors: [], lines: ["empty build request — nothing to build"] };
  }
  if (!codeBuildArmed(env)) {
    return {
      status: "disarmed",
      attempts: 0,
      files: [],
      errors: [],
      lines: [`code-build DISARMED — needs ${CODE_BUILD_FLAG}=true AND ${CODE_BUILD_CONFIRM}=true (two keys). Generated nothing.`],
    };
  }

  let priorErrors: string[] = [];
  let lastFiles: GeneratedFile[] = [];
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const gen = await generate({ request, attempt, priorErrors });
    lastFiles = gen.files;
    if (gen.files.length === 0) {
      lines.push(`attempt ${attempt}: generator produced no files`);
      priorErrors = ["generator produced no files"];
      continue;
    }
    const v = await verify(gen.files);
    if (v.ok) {
      lines.push(`attempt ${attempt}: ${gen.files.length} file(s) — verified GREEN ✓`);
      return { status: "verified", attempts: attempt, files: gen.files, errors: [], lines };
    }
    lines.push(`attempt ${attempt}: ${gen.files.length} file(s) — verify FAILED (${v.errors.length} error(s)); feeding errors back`);
    priorErrors = v.errors;
  }

  lines.push(`exhausted ${maxAttempts} attempt(s) without a green verify — NOT accepted; the artifact is withheld.`);
  return { status: "failed", attempts: maxAttempts, files: lastFiles, errors: priorErrors, lines };
}
