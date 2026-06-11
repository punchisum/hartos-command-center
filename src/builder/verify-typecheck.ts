/**
 * src/builder/verify-typecheck.ts — a REAL verifier for the code-build loop.
 *
 * Does the generated code actually typecheck? Writes the candidate files to a throwaway temp dir
 * and runs `tsc --noEmit`, returning the structured errors the loop feeds back into the next
 * attempt. NODE-HOST ONLY (fs + child process). The tsc invocation is INJECTABLE, so the verifier's
 * own plumbing (path-sanitization, error parsing, temp-dir lifecycle) is unit-testable without
 * spawning a compiler. Path traversal / absolute paths in generated file names are stripped — a
 * generated file can never escape the temp dir.
 */

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import type { GeneratedFile, Verifier, VerifyResult } from "./code-build-core.js";

export interface TypecheckRunResult {
  ok: boolean;
  output: string;
}

/** dir = temp dir the files were written into; files = the written relative paths. */
export type TypecheckRunner = (dir: string, files: string[]) => Promise<TypecheckRunResult>;

/** Default runner: `npx tsc --noEmit` over the generated .ts files (loose, standalone flags). */
export const defaultTypecheckRunner: TypecheckRunner = (dir, files) =>
  new Promise((resolve) => {
    const tsFiles = files.filter((f) => f.endsWith(".ts") || f.endsWith(".tsx"));
    if (tsFiles.length === 0) {
      resolve({ ok: true, output: "no .ts files to typecheck" });
      return;
    }
    const cmd = process.platform === "win32" ? "npx.cmd" : "npx";
    execFile(
      cmd,
      ["--yes", "typescript@5", "tsc", "--noEmit", "--strict", "--skipLibCheck", "--target", "es2022", "--module", "esnext", "--moduleResolution", "bundler", ...tsFiles],
      { cwd: dir, timeout: 180_000, maxBuffer: 10 * 1024 * 1024 },
      (err, stdout, stderr) => {
        resolve({ ok: !err, output: `${stdout ?? ""}${stderr ?? ""}`.trim() });
      },
    );
  });

/** Extract the TSxxxx error lines (capped) — the actionable feedback for the next attempt. */
export function parseTypecheckErrors(output: string): string[] {
  const errs = output.split(/\r?\n/).filter((l) => /error TS\d+/.test(l)).slice(0, 50);
  return errs.length ? errs : output ? [output.slice(0, 500)] : ["typecheck failed (no diagnostic output)"];
}

/** Strip absolute roots + parent-traversal so a generated path can never escape the temp dir. */
export function safeRelPath(p: string): string {
  return p
    .replace(/^[a-zA-Z]:[/\\]/, "")
    .replace(/^[/\\]+/, "")
    .split(/[/\\]/)
    .filter((seg) => seg !== ".." && seg !== "." && seg.length > 0)
    .join("/");
}

export function makeTypecheckVerifier(opts: { runner?: TypecheckRunner; keepDir?: boolean } = {}): Verifier {
  const runner = opts.runner ?? defaultTypecheckRunner;
  return async (files: GeneratedFile[]): Promise<VerifyResult> => {
    if (files.length === 0) return { ok: false, errors: ["no files to verify"] };
    const dir = await mkdtemp(path.join(tmpdir(), "hartos-codebuild-"));
    const written: string[] = [];
    try {
      for (const f of files) {
        const rel = safeRelPath(f.path);
        if (!rel) continue;
        const abs = path.join(dir, rel);
        await mkdir(path.dirname(abs), { recursive: true });
        await writeFile(abs, f.content, "utf8");
        written.push(rel);
      }
      const r = await runner(dir, written);
      return r.ok ? { ok: true, errors: [] } : { ok: false, errors: parseTypecheckErrors(r.output) };
    } finally {
      if (!opts.keepDir) await rm(dir, { recursive: true, force: true }).catch(() => {});
    }
  };
}
