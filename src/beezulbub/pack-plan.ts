/**
 * src/beezulbub/pack-plan.ts
 *
 * Produce a pack plan from the latest digest/batch report.
 * No files are generated under packs/ during planning.
 */

import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import type { PackPlanResult, ScoreJson } from "./pack-types.js";
import { CAPABILITY_TARGETS } from "./registry.js";

const PACK_STRUCTURE_PREVIEW = [
  "packs/<capability>/",
  "  pack.manifest.json",
  "  README.md",
  "  adaptation-plan.md",
  "  source-digest-summary.md",
  "  rejected-poison.md",
  "  implementation-notes.md",
  "  components/README.md",
  "  migrations/README.md",
  "  runtime/README.md",
  "  tests/pack.contract.test.ts",
  "  smoke/smoke-plan.md",
  "  TODO.generated.md",
];

const BASE_TESTS = [
  "pack contract test (manifest valid)",
  "no secret report test",
  "smoke plan exists",
  "adaptation-plan documents absorb/reject",
];

/** Verdicts that allow pack generation */
const DEVOURABLE_VERDICTS = new Set(["DEVOUR", "PARTIAL_DEVOUR"]);

/** Load the best candidate from available reports */
async function loadBestCandidate(
  reportsDir: string,
  explicitPath?: string
): Promise<ScoreJson | null> {
  // Explicit path given
  if (explicitPath && existsSync(explicitPath)) {
    try {
      const raw = await readFile(explicitPath, "utf8");
      return JSON.parse(raw) as ScoreJson;
    } catch { return null; }
  }

  if (!existsSync(reportsDir)) return null;

  const files = await readdir(reportsDir);

  // Try batch JSON first (has ranking)
  const batchFiles = files
    .filter((f) => f.startsWith("batch-digest-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (batchFiles.length > 0) {
    try {
      const raw = await readFile(path.join(reportsDir, batchFiles[0]!), "utf8");
      const batch = JSON.parse(raw) as ScoreJson;
      if (batch.topCandidate && batch.ranking && batch.ranking.length > 0) {
        // Return as a synthetic score with the top ranked item
        const top = batch.ranking[0]!;
        return {
          repoName: top.name,
          verdict: top.verdict,
          score: { overall: top.overall },
          capabilities: [],
          targetPack: "TBD",
          summary: `Batch top candidate: ${top.name}`,
        };
      }
    } catch { /* try next */ }
  }

  // Fall back to latest score JSON
  const scoreFiles = files
    .filter((f) => f.startsWith("score-") && f.endsWith(".json"))
    .sort()
    .reverse();

  if (scoreFiles.length > 0) {
    try {
      const raw = await readFile(path.join(reportsDir, scoreFiles[0]!), "utf8");
      return JSON.parse(raw) as ScoreJson;
    } catch { return null; }
  }

  return null;
}

function capabilitySlug(capabilities: string[], repoName: string, targetPack?: string): string {
  if (capabilities.length > 0) return capabilities[0]!;
  if (targetPack && targetPack !== "TBD") return targetPack.replace(/-pack$/, "");
  // Guess from repo name
  const name = repoName.toLowerCase().replace(/[^a-z0-9]/g, "_");
  for (const known of CAPABILITY_TARGETS) {
    if (name.includes(known.replace(/_/g, ""))) return known;
  }
  return name.slice(0, 30);
}

function detectRisks(candidate: ScoreJson): string[] {
  const risks: string[] = [];
  const verdict = candidate.verdict ?? "";
  if (verdict === "PARTIAL_DEVOUR") risks.push("Partial devour — some capabilities must be rejected");
  if ((candidate.poisonFlagCount ?? 0) > 0) risks.push(`${candidate.poisonFlagCount} poison flag(s) in source repo`);
  if ((candidate.score?.licenseSafety ?? 10) < 7) risks.push("License safety is lower than ideal — review before implementation");
  if (!candidate.capabilities || candidate.capabilities.length === 0) risks.push("No specific capabilities detected — manual extraction required");
  if (!DEVOURABLE_VERDICTS.has(verdict)) risks.push(`Verdict is ${verdict} — generation would be blocked`);
  return risks;
}

export async function buildPackPlan(
  reportsDir: string,
  explicitPath?: string
): Promise<PackPlanResult | null> {
  const candidate = await loadBestCandidate(reportsDir, explicitPath);
  if (!candidate) return null;

  const verdict = candidate.verdict ?? "UNKNOWN";
  const score = candidate.score?.overall ?? 0;
  const repoName = candidate.repoName ?? "unknown";
  const capabilities = candidate.capabilities ?? [];
  const capability = capabilitySlug(capabilities, repoName, candidate.targetPack);
  const packName = capability;

  const absorb = capabilities.length > 0
    ? [`${capability} component patterns`, "HartOS-adapted UI/logic stubs"]
    : ["Component patterns to be identified during implementation"];

  const reject = [
    "Foreign auth model",
    "Foreign database schema",
    "Third-party deployment assumptions",
    "Direct production mutation without HartOS gates",
  ];

  const risks = detectRisks(candidate);

  const testsToGenerate = [
    ...BASE_TESTS,
    ...(capabilities.map((c) => `${c} capability smoke`)),
  ];

  const isDevourable = DEVOURABLE_VERDICTS.has(verdict);
  const nextCommand = isDevourable
    ? `BEEZULBUB_ALLOW_PACK_GENERATE=true npm run beezulbub:pack-generate -- --capability=${capability} --from-latest --approve-devour`
    : `# Verdict is ${verdict} — cannot generate pack. Scout more candidates.`;

  return {
    packName,
    capability,
    sourceRepo: repoName,
    verdict,
    score,
    license: candidate.license ?? null,
    absorb,
    reject,
    risks,
    structurePreview: PACK_STRUCTURE_PREVIEW.map((l) =>
      l.replace("<capability>", packName)
    ),
    testsToGenerate,
    nextCommand,
  };
}

export function formatPackPlan(plan: PackPlanResult): string {
  const lines = [
    `# Beezulbub Pack Plan: ${plan.packName}`,
    ``,
    `## Summary`,
    ``,
    `Capability:  ${plan.capability}`,
    `Source repo: ${plan.sourceRepo}`,
    `Verdict:     ${plan.verdict} (${plan.score}/10)`,
    `License:     ${plan.license ?? "unknown"}`,
    ``,
    `## Absorb`,
    ``,
    ...plan.absorb.map((a) => `- ${a}`),
    ``,
    `## Reject`,
    ``,
    ...plan.reject.map((r) => `- ${r}`),
    ``,
    `## Pack structure`,
    ``,
    "```",
    ...plan.structurePreview,
    "```",
    ``,
    `## Tests to generate`,
    ``,
    ...plan.testsToGenerate.map((t) => `- [ ] ${t}`),
    ``,
  ];

  if (plan.risks.length > 0) {
    lines.push(`## Risks`);
    lines.push(``);
    plan.risks.forEach((r) => lines.push(`⚠ ${r}`));
    lines.push(``);
  }

  lines.push(`## Next`);
  lines.push(``);
  lines.push("```bash");
  lines.push(plan.nextCommand);
  lines.push("```");
  lines.push(``);
  lines.push(`---`);
  lines.push(`Generated by HartOS Beezulbub Phase 11C`);

  return lines.join("\n") + "\n";
}
