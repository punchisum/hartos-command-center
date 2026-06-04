/**
 * src/beezulbub/cto-contracts.ts
 *
 * CTO-readable contract definitions.
 * Documents what the future CTO agent is allowed to read and request.
 *
 * Phase 11D: Docs/contracts only — no CTO agent yet.
 * Phase 11F will implement the actual CTO agent.
 */

/** What the CTO agent is allowed to READ */
export const CTO_READABLE_INPUTS = [
  "capability registry (capabilities/capability-registry.json)",
  "pack registry (packs/*/pack.manifest.json)",
  "pack lifecycle status (manifest.status)",
  "pack verification reports (beezulbub-reports/pack-verify-*.md)",
  "provenance ledger (capabilities/provenance-ledger.json)",
  "conflict reports (beezulbub-reports/pack-conflicts-*.md)",
] as const;

/** What the CTO agent is allowed to REQUEST */
export const CTO_REQUESTABLE_OUTPUTS = [
  "pack plan for a capability target",
  "list of available capabilities",
  "verification status for a specific pack",
  "conflict analysis for a set of packs",
] as const;

/** What the CTO agent must NEVER assume */
export const CTO_FORBIDDEN_ASSUMPTIONS = [
  "A pack with status=skeleton is usable",
  "A pack with status=implementation_draft is production-ready",
  "Provenance-missing packs are safe to compose",
  "Verification is optional for promotion",
  "REFERENCE_ONLY packs can be used as implementations",
  "Any pack without a passing pack-verify is safe",
  "A pack can be deployed without HartOS promotion gates",
] as const;

/** Pack status interpretation for CTO */
export const PACK_STATUS_FOR_CTO: Record<string, string> = {
  "skeleton": "NOT usable — stubs only, needs implementation",
  "reference_only": "NOT usable — study reference only",
  "implementation_draft": "NOT production-ready — stubs generated, needs review",
  "verified": "Locally verified — can be used in staging with caution",
  "available": "Safe for CTO to compose into agents",
  "deprecated": "Do NOT use — replaced by newer version",
  "rejected": "BLOCKED — poison, license, or low value",
};

/** Capability status interpretation for CTO */
export const CAPABILITY_STATUS_FOR_CTO: Record<string, string> = {
  "missing": "Capability not yet scouted",
  "scouted": "Candidate identified — not yet digested",
  "devour_recommended": "Digest recommends devour — not yet packed",
  "pack_skeleton_created": "Pack skeleton exists — NOT ready for use",
  "implementation_pending": "Awaiting implementation stubs",
  "implementation_draft": "Implementation stubs exist — NOT production-ready",
  "verified": "Locally verified — staging use with caution",
  "available": "Safe to compose into agents",
  "in_use": "Currently active in one or more agents",
  "retired": "No longer maintained — do not use for new builds",
  "rejected": "BLOCKED",
};

export function formatCtoSummary(): string {
  return [
    `# CTO Pack Contract`,
    ``,
    `## Inputs CTO can consume`,
    ``,
    ...CTO_READABLE_INPUTS.map((i) => `- ${i}`),
    ``,
    `## Outputs CTO can request`,
    ``,
    ...CTO_REQUESTABLE_OUTPUTS.map((o) => `- ${o}`),
    ``,
    `## Forbidden assumptions`,
    ``,
    ...CTO_FORBIDDEN_ASSUMPTIONS.map((f) => `- ❌ ${f}`),
    ``,
    `## Pack status interpretation`,
    ``,
    ...Object.entries(PACK_STATUS_FOR_CTO).map(([s, d]) => `- \`${s}\`: ${d}`),
    ``,
    `## Capability status interpretation`,
    ``,
    ...Object.entries(CAPABILITY_STATUS_FOR_CTO).map(([s, d]) => `- \`${s}\`: ${d}`),
    ``,
    `---`,
    `Phase 11D — CTO Agent implementation in Phase 11F.`,
  ].join("\n") + "\n";
}
