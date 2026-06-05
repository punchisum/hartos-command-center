/**
 * src/cockpit/control-surface/fact-bundle.ts
 *
 * Phase 18E — Cockpit Control Surface. The fact-bundle contract: the typed spine
 * every agent exposes so the cockpit can show *facts with provenance* and the LLM
 * can only SELECT / SUMMARIZE / EXPLAIN over them.
 *
 * The one architecture rule (non-negotiable):
 *   Source of truth CALCULATES facts.  →  LLM SELECTS / SUMMARIZES / EXPLAINS.  →  UI DISPLAYS both.
 *
 * `verdict`, `confidence`, and each fix's `severity` are COMPUTED deterministically
 * (see verdict-rules.ts) BEFORE the LLM is ever called. The LLM receives them as
 * inputs to *explain*, never to produce. Nothing in this surface ever executes a
 * provider mutation — every action is approve / reject / explain / copy-CLI / open.
 */

/**
 * Freshness of a single datum.
 *   fresh   — younger than the fresh window (< 6h)
 *   stale   — older than the fresh window but not dead (6h–72h)
 *   dead    — older than the dead window (> 72h) OR the last check failed
 *   unknown — value is null / could not be fetched ("missing means missing")
 */
export type Freshness = "fresh" | "stale" | "dead" | "unknown";

/** A single fact carries its own provenance — never a bare value. */
export interface Fact<T = string | number> {
  /** Stable machine key, e.g. "calories_today". */
  key: string;
  /** Human label, e.g. "Calories today". */
  label: string;
  /** The value, or null when unknown / unfetched. */
  value: T | null;
  /** Optional unit, e.g. "kcal". */
  unit?: string;
  /** ISO timestamp of the underlying datum, or null when unknown. */
  asOf: string | null;
  /** Where the datum came from, e.g. "fitness RPC" | "provision ledger". */
  source: string;
  /** Computed from asOf vs now (or "unknown" when value === null). */
  freshness: Freshness;
}

/** Per-agent health check. `state` mirrors the mockup's g/a/r/i palette. */
export interface HealthCheck {
  name: string;
  state: "g" | "a" | "r" | "i" | "unknown";
  detail: string;
}

/** One audit-trail event for an agent. */
export interface AuditEvent {
  event: string;
  at: string;
  level: "g" | "a" | "r";
}

/** Deterministic verdict over an agent's facts + health. */
export type Verdict = "GREEN" | "AMBER" | "RED" | "UNKNOWN";

/** Deterministic confidence = worst freshness among the agent's facts. */
export type Confidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

/**
 * Computed severity tier for a fix/attention item. Ranking (highest first):
 *   security > stale-revenue > blocked > next > note
 * The LLM may only order *within* a tier — it can never set the tier.
 */
export type FixSeverity = "security" | "stale-revenue" | "blocked" | "next" | "note";

/**
 * The action a fix produces. It is ALWAYS one of these three — there is no
 * "execute" kind anywhere in the cockpit. A fix yields a command Hart runs on the
 * Node host (copy_cli), a proposal to approve (open_proposal), or a link to open
 * (open_link). It NEVER runs anything itself.
 */
export type FixActionKind = "copy_cli" | "open_proposal" | "open_link";

export interface FixAction {
  kind: FixActionKind;
  /** The CLI command, proposal id/ref, or URL — never a live trigger. */
  payload: string;
}

export interface FixRecommendation {
  /** Computed tier — never set by the LLM. */
  severity: FixSeverity;
  /** Prose (LLM or deterministic). */
  title: string;
  /** Prose; must reference the fact(s) behind it. */
  why: string;
  /** Always copy_cli / open_proposal / open_link — never execute. */
  action: FixAction;
}

/** The LLM-authored summary, with its own freshness stamp. */
export interface AgentSummary {
  text: string;
  generatedAt: string;
  /** Keys of the facts the prose leaned on (provenance for the words). */
  citedFactKeys: string[];
  /**
   * True when the summary is older than the freshest fact it describes — a
   * confident paragraph describing yesterday's data is a lie, so we badge it.
   */
  stale: boolean;
}

/**
 * The complete typed bundle for one agent. The LLM may only touch `summary`,
 * the prose inside `fixes`, and `selectedFactKeys` (card highlight choice).
 * Everything else is computed.
 */
export interface AgentFactBundle {
  agentId: string;
  name: string;
  /** Short emoji/icon hint for the card + drawer (display only). */
  icon: string;
  purpose: string;
  /** The allowed bundle the LLM may pick from. */
  facts: Fact[];
  health: HealthCheck[];
  capabilities: string[];
  /** Includes 🔒 hard limits, e.g. "never service-role to shared DB". */
  permissions: string[];
  audit: AuditEvent[];
  // ── computed, NOT from LLM ──
  verdict: Verdict;
  confidence: Confidence;
  /** True when the whole bundle could not be fetched (facts all null/empty). */
  unavailable: boolean;
  // ── from LLM, over the above ──
  /** Keys of the (up to 3) facts the LLM chose to highlight on the card. */
  selectedFactKeys: string[];
  /** Computed-verdict explanation (LLM prose over the rule result). */
  whyVerdict: string;
  summary: AgentSummary;
  /** Severity-ranked (computed tier); LLM only orders within a tier. */
  fixes: FixRecommendation[];
}
