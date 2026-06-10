/**
 * src/runtime/cloudflare-cockpit-types.ts
 *
 * Types for the Cloudflare-hosted read-only cockpit (Phase 11J).
 *
 * The hosted cockpit is a THIN adapter over the existing local cockpit logic.
 * Cloudflare Workers have no filesystem, so the Worker operates on a snapshot
 * CONTEXT that is built once (in Node, at dry-run/deploy time via the existing
 * buildCockpitState/renderCockpitHtml) and handed to the Worker. The Worker
 * itself never reads the filesystem, never mutates anything, and never executes
 * an action.
 */

import type { CockpitState, CockpitReportRef } from "../cockpit/cockpit-types.js";
import type { ControlSurfaceRender } from "../cockpit/control-surface/index.js";
import type { AgentDetail } from "../read-models/agent-detail.js";
import type { GenericAgentDetail } from "../read-models/agent-detail-registry.js";
import type { ActionProposal } from "../cockpit/proposals/proposal-types.js";
import type { ProposalPersistResult, ProposalTransitionResult, CockpitTransitionAction } from "./cloudflare-live-read-models.js";
import type { CockpitThreadSummary } from "../cockpit/threads/cockpit-thread-spine.js";
import type { AskInfer } from "../llm/ask-llm.js";
import type { RinneganNote } from "../rinnegan/rinnegan-types.js";

/** Server-side env available to the hosted cockpit. Values are NEVER exposed. */
export type CloudflareCockpitEnv = Record<string, string | undefined>;

/**
 * A pre-built, render-ready snapshot the Worker serves. Built in Node from the
 * existing cockpit read model; the Worker treats it as immutable read-only data.
 * All fields are optional so the default export stays valid before a snapshot is
 * baked in (it then serves a safe placeholder).
 */
export interface CockpitWorkerContext {
  state?: CockpitState;
  html?: string;
  reports?: CockpitReportRef[];
  threads?: string[];
  /** "hosted" on Cloudflare; informational only. */
  runtimeMode?: string;
  generatedAt?: string;
  /**
   * Phase 16D — lazy LIVE read-model resolver. When set (the Cloudflare default
   * export), it is called at most once per request, AFTER auth, and only for
   * data routes — so no read happens for /health, login, or unauthenticated
   * requests. Returns undefined to decline (no env configured / read failed),
   * in which case the Worker serves the safe placeholder.
   */
  liveStateProvider?: () => Promise<CockpitState | undefined>;
  /**
   * Phase 18F — lazy LIVE control-surface resolver (the 18E surface). Called at
   * most once per request, AFTER auth, and only for the two control-surface
   * routes (GET /control, GET /api/control-surface). Returns undefined to decline,
   * in which case those routes serve the honest UNKNOWN placeholder.
   */
  controlSurfaceProvider?: () => Promise<ControlSurfaceRender | undefined>;
  /**
   * Phase C — lazy per-agent DETAIL resolver. Called only for the GET /agent/{domain}
   * routes, AFTER auth. Returns null to decline (no env configured / read failed),
   * in which case the route serves an honest "unavailable" payload.
   */
  agentDetailProvider?: (domain: string) => Promise<AgentDetail | GenericAgentDetail | null>;
  /**
   * Phase E (Gap E) — gated "Ask HartOS → proposal" writer. Called from POST
   * /api/ask ONLY when the deterministic answer produced proposal drafts. It
   * persists them into the Supabase spine via the gated Edge Function — the Worker
   * holds only a capability token, never a DB/service key. Absent ⇒ the Ask stays
   * advisory (no write). Must never throw.
   */
  proposalWriteProvider?: (proposals: ActionProposal[], sourceIntent: string) => Promise<ProposalPersistResult>;
  /**
   * Phase 2.4 — gated approve/reject. Called from POST /api/proposals/transition. Relays
   * the transition to the SAME capability-token Edge Function (the Worker holds no DB key);
   * the Edge Function performs the conditional, status-safe write. Absent ⇒ advisory-only.
   * Must never throw.
   */
  proposalTransitionProvider?: (input: { id: string; action: CockpitTransitionAction }) => Promise<ProposalTransitionResult>;
  /**
   * LLM Ask 2A — OPTIONAL injected inference for POST /api/ask. The Worker-safe orchestrator
   * (`composeAskAnswer`) redacts the request FIRST, then consults this; on any null/invalid/
   * throwing result it falls back to the deterministic grounding (never laundered). The Worker
   * leaves this UNSET — the deterministic answer is unchanged — because the gated `LlmGateway`
   * is key-bearing and Node/Edge-only; a Node/Edge host injects `buildAskInfer(...)` here to
   * light up reasoning. The LLM may reason/propose, NEVER execute or approve.
   */
  askInfer?: AskInfer;
  /**
   * Phase D — lazy LIVE thread-spine reader. Called only for GET /api/threads,
   * AFTER auth. Returns the thread summaries from Supabase (so the hosted Worker
   * shows threads that no longer live only on the filesystem), or null to fall
   * back to the (empty on hosted) local list. Never throws.
   */
  threadsProvider?: () => Promise<CockpitThreadSummary[] | null>;
  /** Rinnegan — the Worker-readable vault context pack (Supabase mirror), for Ask briefings. */
  contextPackProvider?: () => Promise<RinneganNote[] | null>;
}

/** Result of a deploy-gate check, following the Factory gate doctrine. */
export interface CockpitDeployGateResult {
  status: "ready" | "blocked_missing_gate";
  missingGates: string[];
  /** Env names whose presence is required (never the values). */
  requiredEnvPresent: { name: string; present: boolean }[];
  message: string;
}

export interface EnvPresence {
  name: string;
  present: boolean;
  secret: boolean;
}

export type CloudflareReportKind = "check" | "dry-run" | "deploy-plan" | "deploy";
