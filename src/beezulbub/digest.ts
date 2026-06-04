/**
 * src/beezulbub/digest.ts
 *
 * Digest a local repository — reads files, detects stack, extracts capabilities.
 *
 * Phase 11A: Local path only.
 * Phase 11B: URL detection returns manual_required with clone instructions.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { DigestOptions, RepoDigest } from "./types.js";
import { checkFilePaths, checkCodeContent, checkArchitecture, summarisePoisonFlags } from "./poison-filter.js";
import { checkLicense, extractLicenseFromPackageJson, guesslicenseFromContent } from "./license-check.js";
import { extractCapabilities } from "./capability-extractor.js";
import { buildAdaptationPlan } from "./adaptation-plan.js";
import { scoreDigest } from "./score.js";
import { isGitUrl, generateCloneInstructions } from "./manual-clone.js";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt",
  "coverage", ".cache", "__pycache__", ".venv", "venv",
]);

const CODE_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".rb", ".go", ".rs", ".java", ".cs",
  ".vue", ".svelte", ".astro",
]);

async function walkDir(dir: string, maxDepth = 4, depth = 0): Promise<string[]> {
  if (depth > maxDepth) return [];
  if (!existsSync(dir)) return [];

  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await walkDir(fullPath, maxDepth, depth + 1));
    } else {
      files.push(fullPath);
    }
  }

  return files;
}

function detectFrameworks(deps: string[]): string[] {
  const frameworks: string[] = [];
  const allDeps = deps.map((d) => d.toLowerCase());

  if (allDeps.some((d) => d.startsWith("react"))) frameworks.push("React");
  if (allDeps.some((d) => d.startsWith("next"))) frameworks.push("Next.js");
  if (allDeps.some((d) => d.startsWith("vue"))) frameworks.push("Vue");
  if (allDeps.some((d) => d.startsWith("nuxt"))) frameworks.push("Nuxt");
  if (allDeps.some((d) => d.startsWith("svelte"))) frameworks.push("Svelte");
  if (allDeps.some((d) => d === "express" || d.startsWith("express@"))) frameworks.push("Express");
  if (allDeps.some((d) => d === "fastify" || d.startsWith("fastify@"))) frameworks.push("Fastify");
  if (allDeps.some((d) => d === "hono" || d.startsWith("hono@"))) frameworks.push("Hono");
  if (allDeps.some((d) => d.startsWith("supabase"))) frameworks.push("Supabase");
  if (allDeps.some((d) => d.startsWith("tailwindcss"))) frameworks.push("Tailwind CSS");
  if (allDeps.some((d) => d.startsWith("prisma"))) frameworks.push("Prisma");
  if (allDeps.some((d) => d.startsWith("drizzle"))) frameworks.push("Drizzle ORM");
  if (allDeps.some((d) => d === "graphql")) frameworks.push("GraphQL");

  return frameworks;
}

function detectStack(filePaths: string[], deps: string[]): string[] {
  const stack: string[] = [];
  const extensions = new Set(filePaths.map((f) => path.extname(f).toLowerCase()));
  const lowerDeps = deps.map((d) => d.toLowerCase());

  if (extensions.has(".ts") || extensions.has(".tsx")) stack.push("TypeScript");
  if (extensions.has(".py")) stack.push("Python");
  if (extensions.has(".go")) stack.push("Go");
  if (extensions.has(".rs")) stack.push("Rust");

  if (lowerDeps.some((d) => d.startsWith("react"))) stack.push("React");
  if (lowerDeps.some((d) => d.startsWith("@cloudflare/workers"))) stack.push("Cloudflare Workers");
  if (lowerDeps.some((d) => d.startsWith("@supabase"))) stack.push("Supabase");
  if (lowerDeps.some((d) => d.startsWith("trigger"))) stack.push("Trigger.dev");

  if (filePaths.some((f) => f.includes("wrangler.toml"))) stack.push("Wrangler/Cloudflare");
  if (filePaths.some((f) => f.includes("Dockerfile"))) stack.push("Docker");
  if (filePaths.some((f) => f.includes("docker-compose"))) stack.push("Docker Compose");
  if (filePaths.some((f) => f.includes(".github/workflows"))) stack.push("GitHub Actions");

  return [...new Set(stack)];
}

function detectTestPresence(
  filePaths: string[],
  scripts: Record<string, string>
): "none" | "minimal" | "present" {
  const hasTestScript = Object.keys(scripts).some((k) =>
    k === "test" || k.startsWith("test:")
  );
  const hasTestFiles = filePaths.some((f) =>
    f.includes(".test.") || f.includes(".spec.") ||
    f.includes("__tests__") || f.includes("/tests/")
  );

  if (hasTestFiles && hasTestScript) return "present";
  if (hasTestFiles || hasTestScript) return "minimal";
  return "none";
}

function detectEnvHandling(filePaths: string[], codeContent: string): "none" | "basic" | "safe" | "unsafe" {
  const hasEnvExample = filePaths.some((f) =>
    f.endsWith(".env.example") || f.endsWith(".env.sample")
  );
  const hasEnvFile = filePaths.some((f) =>
    path.basename(f) === ".env"
  );
  const usesProcessEnv = codeContent.includes("process.env");
  const hasHardcodedSecrets = /(?:api[_-]?key|password|secret)\s*[=:]\s*["'][^"']{4,}/i.test(
    codeContent
  );

  if (hasHardcodedSecrets || hasEnvFile) return "unsafe";
  if (hasEnvExample && usesProcessEnv) return "safe";
  if (usesProcessEnv) return "basic";
  return "none";
}

function detectDeployScripts(scripts: Record<string, string>): string[] {
  const dangerous: string[] = [];
  for (const [name, cmd] of Object.entries(scripts)) {
    if (
      (name.includes("deploy") || name.includes("release") || name.includes("publish")) &&
      (cmd.includes("production") || cmd.includes("prod") || cmd.includes("--env prod"))
    ) {
      dangerous.push(`${name}: ${cmd}`);
    }
  }
  return dangerous;
}

export async function digestLocalRepo(options: DigestOptions): Promise<RepoDigest> {
  const { localPath, targetCapability } = options;
  const digestedAt = new Date().toISOString();

  // Phase 11B: Detect if a URL was passed instead of a local path
  if (isGitUrl(localPath)) {
    throw new Error(
      `URL provided but manual_required for clone.\n\n` +
        generateCloneInstructions(localPath, targetCapability) +
        `\nOr set BEEZULBUB_ALLOW_CLONE=true to automate the clone step.`
    );
  }

  const repoName = path.basename(localPath);

  if (!existsSync(localPath)) {
    throw new Error(
      `Repo path not found: ${localPath}\n` +
        `If this is a GitHub URL, clone it first:\n` +
        `  git clone <url> ${localPath}\n` +
        `  Then re-run with --repo=${localPath}`
    );
  }

  // Walk all files
  const allFiles = await walkDir(localPath);
  const relativePaths = allFiles.map((f) => path.relative(localPath, f));

  // Read package.json if present
  let pkg: Record<string, unknown> = {};
  const pkgPath = path.join(localPath, "package.json");
  if (existsSync(pkgPath)) {
    try {
      pkg = JSON.parse(await readFile(pkgPath, "utf8")) as Record<string, unknown>;
    } catch { /* ignore */ }
  }

  // Read all code files (limit to reasonable size)
  const codeFiles = allFiles.filter((f) => CODE_EXTENSIONS.has(path.extname(f).toLowerCase()));
  let combinedCode = "";
  for (const file of codeFiles.slice(0, 50)) {
    try {
      const content = await readFile(file, "utf8");
      if (content.length < 100_000) combinedCode += content + "\n";
    } catch { /* ignore */ }
  }

  // Dependencies
  const dependencies = Object.keys((pkg["dependencies"] as Record<string, unknown>) ?? {});
  const devDependencies = Object.keys((pkg["devDependencies"] as Record<string, unknown>) ?? {});
  const scripts = (pkg["scripts"] as Record<string, string>) ?? {};
  const allDeps = [...dependencies, ...devDependencies];

  // License
  let licenseText = extractLicenseFromPackageJson(pkg);
  if (!licenseText) {
    const licenseFile = allFiles.find((f) =>
      /^LICENSE(?:\.[A-Z]+)?$|^LICENCE(?:\.[A-Z]+)?$|^COPYING$/i.test(path.basename(f))
    );
    if (licenseFile) {
      try {
        const content = await readFile(licenseFile, "utf8");
        licenseText = guesslicenseFromContent(content) ?? content.slice(0, 100);
      } catch { /* ignore */ }
    }
  }
  const licenseResult = checkLicense(licenseText);

  // Package managers
  const packageManagers: string[] = [];
  if (existsSync(path.join(localPath, "package.json"))) packageManagers.push("npm/yarn/pnpm");
  if (existsSync(path.join(localPath, "requirements.txt"))) packageManagers.push("pip");
  if (existsSync(path.join(localPath, "go.mod"))) packageManagers.push("go modules");
  if (existsSync(path.join(localPath, "Cargo.toml"))) packageManagers.push("cargo");

  // Detect stack + frameworks
  const detectedStack = detectStack(relativePaths, allDeps);
  const frameworks = detectFrameworks(allDeps);
  const testPresence = detectTestPresence(relativePaths, scripts);
  const envHandling = detectEnvHandling(relativePaths, combinedCode);
  const deployScripts = detectDeployScripts(scripts);

  // Poison detection
  const filePoison = checkFilePaths(relativePaths);
  const codePoison = checkCodeContent(combinedCode);
  const archPoison = checkArchitecture({
    hasTests: testPresence !== "none",
    deployScripts,
    hasDeepVendorLock: frameworks.some((f) => ["Firebase", "AWS Amplify"].includes(f)),
    bypassesGates: false,
  });
  const poisonFlags = [...filePoison, ...codePoison, ...archPoison];

  // Capabilities
  const usefulCapabilities = extractCapabilities({
    dependencies,
    devDependencies,
    frameworks,
    filePaths: relativePaths,
    scripts,
    targetCapability,
  });

  // Score + verdict
  const score = scoreDigest({
    licenseRisk: licenseResult.risk,
    testPresence,
    poisonFlags,
    dependencies: allDeps,
    capabilities: usefulCapabilities,
    frameworks,
  });

  // Adaptation plan
  const hartosAdaptationPlan = buildAdaptationPlan({
    capabilities: usefulCapabilities,
    poisonFlags,
    frameworks,
    repoName,
  });

  const summary =
    `${repoName}: verdict=${score.overall >= 7 ? "DEVOUR" : score.overall >= 4 ? "PARTIAL" : "REJECT"}, ` +
    `capabilities=${usefulCapabilities.length}, poison=${poisonFlags.length}, ` +
    `license=${licenseResult.risk}`;

  return {
    repoName,
    localPath,
    digestedAt,
    detectedStack,
    license: licenseText ?? undefined,
    licenseRisk: licenseResult.risk,
    packageManagers,
    frameworks,
    scripts,
    dependencies,
    devDependencies,
    testPresence,
    envHandling,
    usefulCapabilities,
    poisonFlags,
    score,
    recommendedVerdict: deriveVerdict(score, poisonFlags, licenseResult.risk),
    hartosAdaptationPlan,
    summary,
  };
}

function deriveVerdict(
  score: ReturnType<typeof scoreDigest>,
  poisonFlags: ReturnType<typeof checkFilePaths>,
  licenseRisk: string
): RepoDigest["recommendedVerdict"] {
  if (licenseRisk === "risky") return "REJECT_LICENSE";
  if (licenseRisk === "unknown") return "REJECT_LICENSE";

  const hasCriticalPoison = poisonFlags.some((p) => p.severity === "critical");
  const hasHighPoison = poisonFlags.some((p) => p.severity === "high");

  if (hasCriticalPoison && score.capabilityValue < 5) return "REJECT_POISON";
  if (score.maintenanceHealth < 3) return "REJECT_STALE";
  if (score.capabilityValue < 2) return "REJECT_LOW_VALUE";

  if (score.overall >= 7 && !hasCriticalPoison) return "DEVOUR";
  if (score.overall >= 4 || (hasCriticalPoison && score.capabilityValue >= 5)) return "PARTIAL_DEVOUR";
  if (score.capabilityValue >= 4) return "REFERENCE_ONLY";
  return "REJECT_LOW_VALUE";
}
