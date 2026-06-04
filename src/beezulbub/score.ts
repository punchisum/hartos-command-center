/**
 * src/beezulbub/score.ts
 *
 * Score a repo digest to produce a BeezulbubScore.
 */

import type { BeezulbubScore, PoisonFlag, ExtractableCapability } from "./types.js";

interface ScoreInput {
  licenseRisk: "safe" | "review" | "risky" | "unknown";
  testPresence: "none" | "minimal" | "present";
  poisonFlags: PoisonFlag[];
  dependencies: string[];
  capabilities: ExtractableCapability[];
  frameworks: string[];
}

function clamp(v: number, min = 0, max = 10): number {
  return Math.max(min, Math.min(max, v));
}

export function scoreDigest(input: ScoreInput): BeezulbubScore {
  // Capability value: 0-10 based on number and quality of capabilities
  let capabilityValue = clamp(input.capabilities.length * 2.5);
  if (input.capabilities.some((c) => c.estimatedEffort === "low")) capabilityValue = Math.min(10, capabilityValue + 1);

  // License safety: 0-10
  let licenseSafety: number;
  switch (input.licenseRisk) {
    case "safe": licenseSafety = 9; break;
    case "review": licenseSafety = 5; break;
    case "risky": licenseSafety = 1; break;
    case "unknown": licenseSafety = 0; break;
  }

  // Maintenance health: 0-10
  let maintenanceHealth: number;
  switch (input.testPresence) {
    case "present": maintenanceHealth = 8; break;
    case "minimal": maintenanceHealth = 5; break;
    case "none": maintenanceHealth = 2; break;
  }
  // Bonus for modern stack
  if (input.frameworks.some((f) => ["TypeScript", "React", "Tailwind CSS"].includes(f))) {
    maintenanceHealth = Math.min(10, maintenanceHealth + 1);
  }

  // Security risk: 0-10 (higher = worse)
  const criticalPoison = input.poisonFlags.filter((p) => p.severity === "critical").length;
  const highPoison = input.poisonFlags.filter((p) => p.severity === "high").length;
  const mediumPoison = input.poisonFlags.filter((p) => p.severity === "medium").length;
  const securityRisk = clamp(criticalPoison * 4 + highPoison * 2 + mediumPoison * 0.5);

  // Dependency risk: 0-10 (higher = worse)
  const depCount = input.dependencies.length;
  let dependencyRisk = 0;
  if (depCount > 100) dependencyRisk = 8;
  else if (depCount > 50) dependencyRisk = 5;
  else if (depCount > 20) dependencyRisk = 3;
  else if (depCount > 5) dependencyRisk = 1;

  // HartOS compatibility: 0-10
  let hartosCompatibility = 5; // baseline
  if (input.frameworks.includes("TypeScript")) hartosCompatibility += 2;
  if (input.frameworks.includes("Supabase")) hartosCompatibility += 1;
  if (input.frameworks.includes("Cloudflare Workers")) hartosCompatibility += 1;
  if (input.frameworks.includes("Hono")) hartosCompatibility += 1;
  // Incompatible patterns reduce score
  if (input.frameworks.includes("Firebase")) hartosCompatibility -= 2;
  if (input.frameworks.includes("Prisma")) hartosCompatibility -= 1;
  if (input.frameworks.includes("Docker Compose")) hartosCompatibility -= 1;
  hartosCompatibility = clamp(hartosCompatibility);

  // Extraction difficulty: 0-10 (higher = harder)
  let extractionDifficulty = 3; // baseline
  if (input.capabilities.some((c) => c.estimatedEffort === "high")) extractionDifficulty += 3;
  if (input.capabilities.some((c) => c.estimatedEffort === "medium")) extractionDifficulty += 2;
  if (criticalPoison > 0) extractionDifficulty += 2;
  extractionDifficulty = clamp(extractionDifficulty);

  // Overall: weighted composite (higher = better)
  // Invert risk scores for the formula
  const overall = clamp(
    (capabilityValue * 0.30) +
    (licenseSafety * 0.20) +
    (maintenanceHealth * 0.15) +
    ((10 - securityRisk) * 0.20) +
    ((10 - dependencyRisk) * 0.05) +
    (hartosCompatibility * 0.10) +
    ((10 - extractionDifficulty) * 0.00)  // difficulty doesn't affect overall score
  );

  return {
    capabilityValue: Math.round(capabilityValue * 10) / 10,
    licenseSafety: Math.round(licenseSafety * 10) / 10,
    maintenanceHealth: Math.round(maintenanceHealth * 10) / 10,
    securityRisk: Math.round(securityRisk * 10) / 10,
    dependencyRisk: Math.round(dependencyRisk * 10) / 10,
    hartosCompatibility: Math.round(hartosCompatibility * 10) / 10,
    extractionDifficulty: Math.round(extractionDifficulty * 10) / 10,
    overall: Math.round(overall * 10) / 10,
  };
}

export function formatScore(score: BeezulbubScore): string {
  const bar = (v: number, inverted = false) => {
    const pct = inverted ? 10 - v : v;
    const filled = Math.round(pct);
    return "█".repeat(filled) + "░".repeat(10 - filled);
  };

  return [
    `Overall:          ${bar(score.overall)} ${score.overall}/10`,
    `Capability value: ${bar(score.capabilityValue)} ${score.capabilityValue}/10`,
    `License safety:   ${bar(score.licenseSafety)} ${score.licenseSafety}/10`,
    `Maintenance:      ${bar(score.maintenanceHealth)} ${score.maintenanceHealth}/10`,
    `Security risk:    ${bar(score.securityRisk, true)} ${score.securityRisk}/10 (lower=safer)`,
    `Dep risk:         ${bar(score.dependencyRisk, true)} ${score.dependencyRisk}/10 (lower=safer)`,
    `HartOS compat:    ${bar(score.hartosCompatibility)} ${score.hartosCompatibility}/10`,
    `Extract effort:   ${bar(score.extractionDifficulty, true)} ${score.extractionDifficulty}/10 (lower=easier)`,
  ].join("\n");
}
