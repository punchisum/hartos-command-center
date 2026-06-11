/**
 * scripts/code-build.ts — the gated, verify-looped code builder (T5, EXPERIMENTAL).
 *
 * Wires the real LLM generator + the real `tsc --noEmit` verifier into runCodeBuild and writes a
 * GREEN-verified artifact to build-artifacts/<slug>/ for Hart's review. It NEVER writes into the
 * repo and NEVER merges — it produces a reviewed candidate, nothing more. Gated three ways:
 * ALLOW_CODE_BUILD=true AND CONFIRM_CODE_BUILD=true (two keys) AND the LLM gateway armed
 * (HARTOS_LLM_PROVIDER=openai + network + OPENAI_API_KEY).
 *
 * HONEST v1: the project's LLM gateway is purpose-built for STRUCTURED reasoning, not raw multi-file
 * codegen, so the generator below is a best-effort seam — it prompts for fenced TypeScript and parses
 * code blocks out of the response. Fidelity depends on the provider; the harness's guarantee is only
 * that nothing UNVERIFIED is ever written as "built". Swapping in a dedicated raw-codegen provider is
 * the single remaining hookup (the generator is the seam).
 *
 *   ALLOW_CODE_BUILD=true CONFIRM_CODE_BUILD=true HARTOS_LLM_PROVIDER=openai \
 *     HARTOS_LLM_ENABLE_NETWORK=true OPENAI_API_KEY=... npm run code:build -- "a debounce utility"
 */

import { pathToFileURL } from "node:url";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { runCodeBuild, type CodeGenerator, type GeneratedFile, type GenerateInput } from "../src/builder/code-build-core.js";
import { makeTypecheckVerifier } from "../src/builder/verify-typecheck.js";
import { LlmGateway, resolveLlmConfig } from "../src/llm/llm-gateway.js";
import { redact } from "../src/llm/redaction.js";

/** Parse fenced code blocks into files. A leading `// file: <path>` names the file; else generated-N.ts. */
export function parseGeneratedFiles(text: string): GeneratedFile[] {
  const files: GeneratedFile[] = [];
  const fence = /```(?:ts|typescript)?\s*\n([\s\S]*?)```/g;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = fence.exec(text)) !== null) {
    const block = m[1] ?? "";
    const firstLine = block.split(/\r?\n/, 1)[0] ?? "";
    const named = /^\s*\/\/\s*file:\s*(.+)$/i.exec(firstLine);
    const filePath = named ? named[1]!.trim() : `generated-${i}.ts`;
    const content = named ? block.split(/\r?\n/).slice(1).join("\n") : block;
    if (content.trim().length > 0) files.push({ path: filePath, content });
    i += 1;
  }
  return files;
}

function buildPrompt(input: GenerateInput): string {
  const retry = input.priorErrors.length
    ? `\n\nThe previous attempt FAILED typecheck with these errors — fix ALL of them:\n${input.priorErrors.join("\n")}`
    : "";
  return (
    `Implement the following as standalone, strict-mode TypeScript with NO external imports. ` +
    `Respond ONLY with fenced \`\`\`ts code blocks; begin each block with a \`// file: <name>.ts\` line.\n\n` +
    `Requirement: ${input.request}${retry}`
  );
}

/** Best-effort LLM generator over the structured gateway (v1 seam — see file header). */
function makeGatewayGenerator(env: Record<string, string | undefined>): CodeGenerator {
  const gateway = new LlmGateway({ env });
  return async (input: GenerateInput) => {
    const cfg = resolveLlmConfig(env);
    if (!(cfg.provider === "openai" && cfg.networkEnabled && cfg.apiKeyPresent)) {
      return { files: [], notes: "LLM gateway not armed (HARTOS_LLM_PROVIDER=openai + network + OPENAI_API_KEY) — no code generated" };
    }
    const res = await gateway.runCtoReasoning(buildPrompt(input));
    const text = typeof res.output === "string" ? res.output : JSON.stringify(res.output ?? "");
    return { files: parseGeneratedFiles(text), notes: `gateway mode=${res.mode}` };
  };
}

export async function runCodeBuildJob(request: string, env: Record<string, string | undefined>, now: string) {
  const result = await runCodeBuild({
    request,
    env,
    generate: makeGatewayGenerator(env),
    verify: makeTypecheckVerifier(),
    maxAttempts: 3,
  });

  // Write a review artifact ONLY for a green-verified build; never into the repo, never merged.
  if (result.status === "verified") {
    const slug = (request.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "build") + "-" + now.slice(0, 10);
    const dir = path.join(process.cwd(), "build-artifacts", slug);
    await mkdir(dir, { recursive: true });
    for (const f of result.files) {
      const abs = path.join(dir, f.path.replace(/^[/\\]+/, "").replace(/\.\.(\/|\\)/g, ""));
      await mkdir(path.dirname(abs), { recursive: true });
      await writeFile(abs, f.content, "utf8");
    }
    await writeFile(path.join(dir, "BUILD_REPORT.md"), [`# Build — ${request}`, "", `Status: VERIFIED (${result.attempts} attempt(s))`, "", "Files (REVIEW before integrating — nothing was merged):", ...result.files.map((f) => `- ${f.path}`), "", ...result.lines].join("\n"), "utf8");
    result.lines.push(`review artifact → build-artifacts/${slug}/ (NOT merged)`);
  }
  return result;
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const request = process.argv.slice(2).join(" ").trim();
  if (!request) {
    console.error('Usage: ALLOW_CODE_BUILD=true CONFIRM_CODE_BUILD=true ... npm run code:build -- "<requirement>"');
    process.exit(2);
  }
  runCodeBuildJob(request, process.env, new Date().toISOString())
    .then((res) => {
      console.log("\nHartOS — code-build (gated; verify-looped; never merges)\n");
      console.log(`status: ${res.status} · attempts: ${res.attempts}`);
      for (const l of res.lines) console.log(`  ${l}`);
      console.log("");
    })
    .catch((e) => {
      console.error(`code-build failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
