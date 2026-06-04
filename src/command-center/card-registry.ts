/**
 * src/command-center/card-registry.ts
 *
 * The catalogue of Command Center cards (Phase 11G). Each card declares what it
 * is, where its data comes from (local files only), how fresh that data must be,
 * its risk level, and which actions are allowed/blocked.
 *
 * This is a static, deterministic contract. No card reads the network. Every
 * card blocks provider mutation. Dangerous actions are governed by the action
 * and approval contracts — a card listing an action in `allowedActions` does NOT
 * make it safe; its state still comes from the action contract.
 */

import type { CardDefinition, CardGroup } from "./command-center-types.js";

/** Every card blocks provider mutation outright. */
const ALWAYS_BLOCKED = ["execute_provider_mutation"] as const;

export const CARD_REGISTRY: CardDefinition[] = [
  // ─── Orchestrator (the brain's outputs) ──────────────────────────────────
  {
    id: "orchestrator_latest_request",
    group: "orchestrator",
    title: "Latest Orchestrator Request",
    description: "The most recent request the Orchestrator classified and routed.",
    sourceType: "report_dir",
    sourcePaths: ["hartos-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "low",
    allowedActions: ["view_report", "run_orchestrator", "generate_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "orchestrator_strategy_review",
    group: "orchestrator",
    title: "Strategy Review (Prophet)",
    description: "Latest strategy verdict: build now / later / do not build / needs evidence.",
    sourceType: "report_dir",
    sourcePaths: ["hartos-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "low",
    allowedActions: ["view_report", "run_strategy_review"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "orchestrator_cto_review",
    group: "orchestrator",
    title: "CTO Technical Review",
    description: "Latest CTO verdict, capability gaps, and recommended sequence.",
    sourceType: "report_dir",
    sourcePaths: ["hartos-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "low",
    allowedActions: ["view_report", "run_cto_review"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "orchestrator_build_plan",
    group: "orchestrator",
    title: "Build Plan",
    description: "Latest deterministic build plan: phases, approval gates, do-not-build list.",
    sourceType: "report_dir",
    sourcePaths: ["hartos-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "low",
    allowedActions: ["view_report", "run_build_plan"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "orchestrator_handover",
    group: "orchestrator",
    title: "Handover",
    description: "Latest handover summary for pasting into ChatGPT / Claude / Codex.",
    sourceType: "report_dir",
    sourcePaths: ["hartos-reports/", "docs/HANDOVER.md"],
    freshnessPolicy: "latest_report",
    riskLevel: "low",
    allowedActions: ["view_report", "open_handover"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },

  // ─── Factory (provisioning / launch / promotion) ─────────────────────────
  {
    id: "factory_provider_status",
    group: "factory",
    title: "Provider Status",
    description: "Last recorded provider configuration status (local report; no live calls).",
    sourceType: "report_dir",
    sourcePaths: ["launch-reports/", "production-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "medium",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "factory_launch_status",
    group: "factory",
    title: "Launch Status",
    description: "Latest staging/launch verification and readiness report.",
    sourceType: "report_dir",
    sourcePaths: ["launch-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "medium",
    allowedActions: ["view_report", "run_launch_verify"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "factory_bootstrap_status",
    group: "factory",
    title: "Bootstrap / Provisioning Status",
    description: "Latest bootstrap and provisioning verification report.",
    sourceType: "report_dir",
    sourcePaths: ["bootstrap-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "medium",
    allowedActions: ["view_report", "run_bootstrap_verify"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "factory_production_promotion_status",
    group: "factory",
    title: "Production Promotion Status",
    description: "Latest production promotion readiness. Deploy is gated and never automatic.",
    sourceType: "report_dir",
    sourcePaths: ["production-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "high",
    allowedActions: ["view_report", "deploy_agent"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: true,
  },

  // ─── Beezulbub (capabilities / packs) ────────────────────────────────────
  {
    id: "beezulbub_capability_registry",
    group: "beezulbub",
    title: "Capability Registry",
    description: "Capabilities and their lifecycle status from the local registry.",
    sourceType: "json_file",
    sourcePaths: ["capabilities/capability-registry.json"],
    freshnessPolicy: "static",
    riskLevel: "low",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "beezulbub_pack_status",
    group: "beezulbub",
    title: "Pack Status",
    description: "All packs and their lifecycle status. Skeleton/draft packs are not usable.",
    sourceType: "glob",
    sourcePaths: ["packs/*/pack.manifest.json"],
    freshnessPolicy: "static",
    riskLevel: "low",
    allowedActions: ["view_report", "review_pack"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "beezulbub_provenance_health",
    group: "beezulbub",
    title: "Provenance Health",
    description: "Provenance coverage from the local provenance ledger.",
    sourceType: "json_file",
    sourcePaths: ["capabilities/provenance-ledger.json"],
    freshnessPolicy: "static",
    riskLevel: "low",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "beezulbub_conflict_report",
    group: "beezulbub",
    title: "Pack Conflict Report",
    description: "Latest capability/contract conflicts detected across packs.",
    sourceType: "report_dir",
    sourcePaths: ["beezulbub-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "low",
    allowedActions: ["view_report", "generate_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "beezulbub_implementation_drafts",
    group: "beezulbub",
    title: "Implementation Drafts",
    description: "Packs in implementation_draft status. NOT production-ready; require review + provenance before promotion.",
    sourceType: "glob",
    sourcePaths: ["packs/*/pack.manifest.json"],
    freshnessPolicy: "static",
    riskLevel: "medium",
    allowedActions: ["view_report", "review_pack", "promote_pack"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: true,
  },

  // ─── Agents (runtime / debug) ────────────────────────────────────────────
  {
    id: "agents_inventory",
    group: "agents",
    title: "Agents Inventory",
    description: "Known generated agents (derived locally; no live discovery).",
    sourceType: "derived",
    sourcePaths: [],
    freshnessPolicy: "on_demand",
    riskLevel: "low",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "agents_runtime_status",
    group: "agents",
    title: "Agents Runtime Status",
    description: "Last recorded runtime status (local report only; live status is out of scope for 11G).",
    sourceType: "report_dir",
    sourcePaths: ["launch-reports/", "production-reports/"],
    freshnessPolicy: "latest_report",
    riskLevel: "medium",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "agents_debug_events",
    group: "agents",
    title: "Debug Events",
    description: "Debug events are stored in Supabase. Live reads are out of scope for 11G; use exported local reports if present.",
    sourceType: "none",
    sourcePaths: [],
    freshnessPolicy: "on_demand",
    riskLevel: "medium",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "agents_approval_queue",
    group: "agents",
    title: "Approval Queue",
    description: "Pending action tokens / approvals. Approving is human-gated.",
    sourceType: "none",
    sourcePaths: [],
    freshnessPolicy: "on_demand",
    riskLevel: "high",
    allowedActions: ["view_report", "approve_manual_required"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: true,
  },

  // ─── Human control (what only Hart can decide) ───────────────────────────
  {
    id: "human_manual_required",
    group: "human_control",
    title: "Manual Required",
    description: "Items that require a manual human step before anything proceeds.",
    sourceType: "derived",
    sourcePaths: [],
    freshnessPolicy: "on_demand",
    riskLevel: "medium",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "human_pending_approvals",
    group: "human_control",
    title: "Pending Approvals",
    description: "Approval-required actions awaiting a human/admin decision.",
    sourceType: "derived",
    sourcePaths: [],
    freshnessPolicy: "on_demand",
    riskLevel: "high",
    allowedActions: ["view_report", "approve_manual_required"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: true,
  },
  {
    id: "human_blocked_actions",
    group: "human_control",
    title: "Blocked Actions",
    description: "Actions forbidden in Phase 11G (e.g. provider/Supabase mutation).",
    sourceType: "derived",
    sourcePaths: [],
    freshnessPolicy: "static",
    riskLevel: "high",
    allowedActions: ["view_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
  {
    id: "human_next_recommended_command",
    group: "human_control",
    title: "Next Recommended Command",
    description: "The single safe, local command Hart should run next.",
    sourceType: "derived",
    sourcePaths: [],
    freshnessPolicy: "always_regenerate",
    riskLevel: "low",
    allowedActions: ["view_report", "generate_report"],
    blockedActions: [...ALWAYS_BLOCKED],
    requiresApproval: false,
  },
];

export function getCardsByGroup(group: CardGroup): CardDefinition[] {
  return CARD_REGISTRY.filter((c) => c.group === group);
}

export function getCard(id: string): CardDefinition | undefined {
  return CARD_REGISTRY.find((c) => c.id === id);
}

/** All distinct local source paths referenced by any card. */
export function allSourcePaths(): string[] {
  const set = new Set<string>();
  for (const card of CARD_REGISTRY) {
    for (const p of card.sourcePaths) set.add(p);
  }
  return [...set].sort();
}
