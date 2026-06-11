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

export type LlmProviderMode = "deterministic" | "openai" | "gemini";
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
  /** The PRIMARY provider (the one tried first). gemini → openai → deterministic is the chain. */
  provider: LlmProviderMode;
  /** The primary provider's model (Gemini's when provider=gemini, else OpenAI's). */
  model: string;
  /** Hard gate: no network provider is ever called unless this is true. */
  networkEnabled: boolean;
  /** Whether the PRIMARY provider's key is present — the boolean view, safe to surface. */
  apiKeyPresent: boolean;
  /** Whether OPENAI_API_KEY is present (used as the OpenAI-fallback eligibility + research path). */
  openaiKeyPresent?: boolean;
  /** Whether GEMINI_API_KEY is present (primary-eligibility when provider=gemini). */
  geminiKeyPresent?: boolean;
  /** The OpenAI model (default DEFAULT_MODEL); used when OpenAI runs as primary or fallback. */
  openaiModel?: string;
  /** The Gemini model (default DEFAULT_GEMINI_MODEL); used when Gemini runs. */
  geminiModel?: string;
  /**
   * The resolved OpenAI key, threaded from the Worker `env` so the provider reaches it even when
   * `process.env` is empty (the nodejs_compat secret-binding gap that silently disarmed the LLM).
   * NEVER log, serialize, or return this. Read by the OpenAI provider only. Omitted when absent.
   */
  apiKey?: string;
  /** The resolved Gemini key, threaded the same way. NEVER log/serialize. Read by the Gemini provider only. */
  geminiApiKey?: string;
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
export type LlmMode = "deterministic" | "openai" | "gemini" | "fallback";

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
