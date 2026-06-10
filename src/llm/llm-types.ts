/**
 * src/llm/llm-types.ts
 *
 * Types for the governed LLM Gateway (Phase 11I).
 *
 * The gateway is the ONLY boundary through which any module may reach a real
 * LLM provider. It never mutates anything: it classifies, contextualizes, and
 * summarizes into a strict structured JSON contract. When no provider is
 * configured (the default), it falls back to a deterministic provider so the
 * cockpit and CLIs work fully offline.
 */

export type LlmProviderMode = "deterministic" | "openai";
export type LlmConfidence = "low" | "medium" | "high";
export type LlmRiskLevel = "low" | "medium" | "high";

/** The capability requested of the gateway. */
export type LlmRequestType =
  | "classify_and_contextualize"
  | "strategy_reasoning"
  | "cto_reasoning"
  | "summarize_agent_status"
  | "summarize_cockpit_state"
  | "summarize_data_snapshot";

/** Resolved view of how the gateway is configured. */
export interface LlmGatewayConfig {
  provider: LlmProviderMode;
  model: string;
  /** Hard gate: OpenAI is never called unless this is true. */
  networkEnabled: boolean;
  /** Whether OPENAI_API_KEY is present — the boolean view, safe to surface. */
  apiKeyPresent: boolean;
  /**
   * The resolved key, threaded from the Worker `env` so the provider reaches it even when
   * `process.env` is empty (the nodejs_compat secret-binding gap that silently disarmed the LLM).
   * NEVER log, serialize, or return this. Read by the OpenAI provider only. Omitted when absent.
   */
  apiKey?: string;
}

export interface LlmRequest {
  type: LlmRequestType;
  /** The source text (user request, or a thing to summarize). */
  request: string;
  /** Deterministic facts the model may summarize. Never secrets. */
  context?: Record<string, unknown>;
}

/** The strict structured output contract every provider must satisfy. */
export interface LlmStructuredOutput {
  intent: string;
  domain: string;
  confidence: LlmConfidence;
  neededContext: string[];
  recommendedSpecialist: string;
  riskLevel: LlmRiskLevel;
  nextAction: string;
  summary: string;
}

/** How the result was actually produced. */
export type LlmMode = "deterministic" | "openai" | "fallback";

export interface LlmResult {
  output: LlmStructuredOutput;
  provider: LlmProviderMode;
  model: string;
  mode: LlmMode;
  validation: "valid" | "fallback";
  success: boolean;
  requestType: LlmRequestType;
}

/**
 * A provider adapter. `generate` returns RAW, unvalidated output (unknown) so
 * the gateway can validate it centrally and fall back on malformed responses.
 */
export interface LlmProvider {
  readonly name: LlmProviderMode;
  generate(req: LlmRequest, config: LlmGatewayConfig): Promise<unknown>;
}

export interface OutputValidation {
  ok: boolean;
  value?: LlmStructuredOutput;
  error?: string;
}
