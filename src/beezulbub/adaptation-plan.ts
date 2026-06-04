/**
 * src/beezulbub/adaptation-plan.ts
 *
 * Generate a HartOS adaptation plan for extracted capabilities.
 * Specifies what to absorb, what to reject, and how to wire to HartOS.
 */

import type { ExtractableCapability, PoisonFlag, HartOSAdaptationPlan } from "./types.js";

export function buildAdaptationPlan(context: {
  capabilities: ExtractableCapability[];
  poisonFlags: PoisonFlag[];
  frameworks: string[];
  repoName: string;
}): HartOSAdaptationPlan {
  const { capabilities, poisonFlags, frameworks, repoName } = context;

  // Build absorb/reject lists from all capabilities
  const absorbItems = new Set<string>();
  const rejectItems = new Set<string>();
  const adaptSteps: string[] = [];
  const targetPacks = new Set<string>();
  const allTests: string[] = [];
  const allEnvVars: string[] = [];
  const allProviderAdapters: string[] = [];
  const allDbChanges: string[] = [];
  const smokeChecks: string[] = [];
  const securityNotes: string[] = [];

  for (const cap of capabilities) {
    cap.absorb.forEach((a) => absorbItems.add(a));
    cap.reject.forEach((r) => rejectItems.add(r));
    targetPacks.add(cap.hartosPackTarget);
    allTests.push(...cap.requiredTests);
    allEnvVars.push(...cap.requiredEnvVars);
    allProviderAdapters.push(...cap.requiredProviderAdapters);
    allDbChanges.push(...cap.requiredDbChanges);
    cap.securityNotes.forEach((n) => securityNotes.push(n));
  }

  // Remove items that are both in absorb and reject (reject wins)
  for (const r of rejectItems) absorbItems.delete(r);

  // Build adapt steps
  if (capabilities.length === 0) {
    adaptSteps.push("No HartOS-compatible capabilities detected. Manual review required.");
  } else {
    adaptSteps.push(`1. Review ${repoName} source for the following capabilities: ${capabilities.map((c) => c.name).join(", ")}`);
    adaptSteps.push("2. Extract UI/logic components manually — do not copy auth, database, or deploy config");
    adaptSteps.push("3. Adapt components to TypeScript if not already");
    adaptSteps.push("4. Replace data fetching with Supabase RLS-safe queries");
    adaptSteps.push("5. Remove all env var fallback hardcoding");
    adaptSteps.push("6. Add HartOS-standard tests for each extracted component");
    adaptSteps.push("7. Create pack skeleton in `packs/` when Phase 11B is ready");
    adaptSteps.push("8. Wire provider adapters as needed");
  }

  // Add poison-specific reject notes
  const criticalPoison = poisonFlags.filter((p) => p.severity === "critical");
  if (criticalPoison.length > 0) {
    for (const p of criticalPoison) {
      rejectItems.add(`${p.type}: ${p.description}`);
    }
    adaptSteps.push(
      `CRITICAL: Reject all code paths involving ${criticalPoison.map((p) => p.type).join(", ")}`
    );
  }

  // Framework-specific adaptation
  if (frameworks.includes("Firebase")) {
    rejectItems.add("Firebase auth/realtime/Firestore");
    adaptSteps.push("Replace Firebase patterns with Supabase (HartOS source of truth)");
  }
  if (frameworks.includes("Prisma")) {
    rejectItems.add("Prisma schema/migrations");
    adaptSteps.push("Replace Prisma with direct Supabase REST/RPC calls");
  }
  if (frameworks.includes("Docker Compose")) {
    rejectItems.add("Docker Compose deployment assumptions");
    adaptSteps.push("Replace Docker Compose deployment with Cloudflare Workers (HartOS runtime)");
  }

  // Smoke checks
  smokeChecks.push("Bootstrap check passes for extracted components");
  smokeChecks.push("No secrets in extracted code");
  smokeChecks.push("Local smoke test passes");
  if (capabilities.some((c) => c.requiredTests.length > 0)) {
    smokeChecks.push("All capability-specific tests pass");
  }

  const targetPacksList = [...targetPacks];

  return {
    absorb: [...absorbItems],
    reject: [...rejectItems],
    adaptSteps,
    targetPack: targetPacksList.join(", ") || "TBD (Phase 11B)",
    requiredTests: [...new Set(allTests)],
    requiredEnvVars: [...new Set(allEnvVars)],
    requiredProviderAdapters: [...new Set(allProviderAdapters)],
    requiredDbChanges: [...new Set(allDbChanges)],
    requiredSmokeChecks: smokeChecks,
    securityNotes: [...new Set(securityNotes)],
  };
}
