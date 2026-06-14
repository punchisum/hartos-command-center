/**
 * src/organs/organ-roster.ts — the canonical HartOS organ roster (single source of truth for the
 * registry seed). These are the static runtime contracts written at REGISTERED lifecycle by
 * scripts/seed-organ-registry.ts. The DISPLAYED status is always derived (deriveOrganStatus), never
 * taken from here. can_execute = permissions.execute; required_approval_gate = armingFlag.
 *
 * Constraint #8 (this build): no external execution. The only organ with canWriteExternal=true is
 * the Factory, and its external (build/deploy/PR) path stays disarmed — it runs interrogate-only.
 */

export interface OrganContractRow {
  agentId: string;
  displayName: string;
  capabilitySummary: string;
  parentId: string | null;
  tier: string;
  runtimeKind: "worker" | "daemon" | "daemon-supervised" | "external-webhook" | "projection";
  heartbeatSource: string;
  armingFlag: string | null;
  canExecute: boolean;
  canWriteExternal: boolean;
  detailPage: string;
  stalenessThresholdSec: number;
  knownRisks: string[];
}

export const ORGAN_ROSTER: OrganContractRow[] = [
  {
    agentId: "cockpit",
    displayName: "Cockpit",
    capabilitySummary: "Read-only command surface; reflects SOT. Worker cron runs Sentinel heartbeat.",
    parentId: null,
    tier: "T0",
    runtimeKind: "worker",
    heartbeatSource: "worker:/health + cron scheduled()",
    armingFlag: null,
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/cockpit",
    stalenessThresholdSec: 600,
    knownRisks: [],
  },
  {
    agentId: "fitness",
    displayName: "Fitness Agent",
    capabilitySummary: "Logs/coaches fitness; produces draft proposals via the fitness trigger pipeline.",
    parentId: null,
    tier: "T1",
    runtimeKind: "external-webhook",
    heartbeatSource: "agent_actions recency (Hart Personal Core)",
    armingFlag: "HARTOS_FITNESS_POLL",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/fitness",
    stalenessThresholdSec: 172800,
    knownRisks: ["Draft pipeline lives in the separate hart-os-fitness-trigger repo/worker."],
  },
  {
    agentId: "ops",
    displayName: "Ops Projection",
    capabilitySummary: "Read-only projection of the separate GECAN ops system (ClickUp, due-diligence).",
    parentId: null,
    tier: "T0",
    runtimeKind: "projection",
    heartbeatSource: "GECAN sync_runs recency (cross-project)",
    armingFlag: null,
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/ops",
    stalenessThresholdSec: 3600,
    knownRisks: ["Underlying ops runtime is a separate system; HartOS only reads it."],
  },
  {
    agentId: "sentinel",
    displayName: "Sentinel",
    capabilitySummary: "Assesses fleet liveness; raises advisory Wolverine fixes; dead-man's-switch.",
    parentId: null,
    tier: "T1",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(sentinel) + worker cron",
    armingFlag: "HARTOS_ALLOW_SENTINEL_WOLVERINE",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/sentinel",
    stalenessThresholdSec: 900,
    knownRisks: [],
  },
  {
    agentId: "prophet",
    displayName: "Prophet",
    capabilitySummary: "Forecasts/perception synthesis; powers the autopilot pulse + Ask grounding.",
    parentId: null,
    tier: "T1",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(prophet)",
    armingFlag: "HARTOS_ALLOW_PROPHET_PULSE",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/prophet",
    stalenessThresholdSec: 3600,
    knownRisks: ["Pulse arming flag default OFF — lands PARTIAL until armed."],
  },
  {
    agentId: "rinnegan",
    displayName: "Rinnegan",
    capabilitySummary: "Compiles context packs / briefing synthesis for the Ask path.",
    parentId: null,
    tier: "T1",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(rinnegan)",
    armingFlag: "HARTOS_ALLOW_RINNEGAN_SYNC",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/rinnegan",
    stalenessThresholdSec: 3600,
    knownRisks: ["Sync arming flag default OFF — lands PARTIAL until armed."],
  },
  {
    agentId: "wolverine",
    displayName: "Wolverine",
    capabilitySummary: "Immune-system audit; raises advisory fix proposals. Never restarts agents.",
    parentId: null,
    tier: "T2",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(wolverine)",
    armingFlag: "HARTOS_ALLOW_WOLVERINE_AUDIT",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/wolverine",
    stalenessThresholdSec: 3600,
    knownRisks: ["Advisory only — proposes fixes, never executes them."],
  },
  {
    agentId: "beezulbub",
    displayName: "Beezulbub",
    capabilitySummary: "Capability scout; hunts external repos and files dossiers (read-only external).",
    parentId: null,
    tier: "T2",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(beezulbub)",
    armingFlag: "BEEZULBUB_ALLOW_NETWORK",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/beezulbub",
    stalenessThresholdSec: 86400,
    knownRisks: ["Reads external GitHub; gated by BEEZULBUB_ALLOW_NETWORK."],
  },
  {
    agentId: "research",
    displayName: "Research Agent",
    capabilitySummary: "Gathers + synthesizes research briefs into vault dossiers (read-only web).",
    parentId: null,
    tier: "T2",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(research)",
    armingFlag: "HARTOS_RESEARCH_GATHER",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/research",
    stalenessThresholdSec: 86400,
    knownRisks: ["OpenAI account out of credit; Gemini fallback — may land PARTIAL."],
  },
  {
    agentId: "factory",
    displayName: "Agent Factory",
    capabilitySummary: "Interrogates specs + builds agents. Build/deploy is external — disarmed this build.",
    parentId: null,
    tier: "T3",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(factory)",
    armingFlag: "ALLOW_CODE_BUILD",
    canExecute: true,
    canWriteExternal: true,
    detailPage: "/agent/factory",
    stalenessThresholdSec: 86400,
    knownRisks: ["External build/deploy/PR path stays disarmed per constraint #8 (interrogate-only)."],
  },
  {
    agentId: "council",
    displayName: "Council",
    capabilitySummary: "Multi-specialist deliberation; synthesizes propose-only council plans.",
    parentId: null,
    tier: "T3",
    runtimeKind: "daemon-supervised",
    heartbeatSource: "organ_runs(council)",
    armingFlag: "HARTOS_ALLOW_COUNCIL",
    canExecute: false,
    canWriteExternal: false,
    detailPage: "/agent/council",
    stalenessThresholdSec: 86400,
    knownRisks: ["No autonomous goal source — needs HARTOS_COUNCIL_GOAL. Lands PARTIAL until armed+goal."],
  },
];
