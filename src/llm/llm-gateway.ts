/**
 * src/llm/llm-gateway.ts
 *
 * The governed LLM Gateway. Every module that wants LLM reasoning goes through
 * here — never directly to a provider. Architecture:
 *
 *   caller → LlmGateway → provider CHAIN (gemini → openai → deterministic)
 *                       → output validator → safe structured result
 *
 * Defaults to the deterministic provider. A network provider is selected only when
 * HARTOS_LLM_PROVIDER=gemini|openai AND HARTOS_LLM_ENABLE_NETWORK=true AND that
 * provider's key is present. The PRIMARY provider is tried first; if it errors or
 * returns malformed output, the OTHER network provider (whose key is present) is
 * tried as a fallback; if that also fails, the deterministic provider answers. It
 * never crashes. Optionally writes a redacted usage log.
 */

import path from "node:path";
import type {
  LlmGatewayConfig,
  LlmProvider,
  LlmProviderMode,
  LlmRequest,
  LlmRequestType,
  LlmResult,
  LlmCouncilResult,
} from "./llm-types.js";
import { deterministicProvider, deterministicOutput } from "./providers/deterministic-provider.js";
import { openAiProvider } from "./providers/openai-provider.js";
import { geminiProvider } from "./providers/gemini-provider.js";
import { validateLlmOutput, validateCouncilSpecialistOutput } from "./output-validator.js";
import { DEFAULT_LLM_REPORTS_DIR, writeUsageLog } from "./usage-log.js";

export const DEFAULT_MODEL = "gpt-4o-mini";
// flash-lite measured most-available on the free tier (flash 429s under load); the gateway still
// retries transient 5xx/429 and falls back to OpenAI. Override with HARTOS_GEMINI_MODEL.
export const DEFAULT_GEMINI_MODEL = "gemini-2.5-flash-lite";

/** The two network providers, in no particular order (the chain orders them per primary). */
type NetworkMode = "gemini" | "openai";

type Env = Record<string, string | undefined>;

/** Resolve gateway configuration from environment. Never exposes either key. */
export function resolveLlmConfig(env: Env = process.env): LlmGatewayConfig {
  const providerRaw = (env["HARTOS_LLM_PROVIDER"] ?? "deterministic").toLowerCase();
  const provider: LlmProviderMode =
    providerRaw === "gemini" ? "gemini" : providerRaw === "openai" ? "openai" : "deterministic";
  const networkEnabled = env["HARTOS_LLM_ENABLE_NETWORK"] === "true";

  const openaiKey = env["OPENAI_API_KEY"];
  const geminiKey = env["GEMINI_API_KEY"];
  const openaiKeyPresent = typeof openaiKey === "string" && openaiKey.trim().length > 0;
  const geminiKeyPresent = typeof geminiKey === "string" && geminiKey.trim().length > 0;

  const openaiModel = env["HARTOS_LLM_MODEL"]?.trim() || DEFAULT_MODEL;
  const geminiModel = env["HARTOS_GEMINI_MODEL"]?.trim() || DEFAULT_GEMINI_MODEL;

  // `model` + `apiKeyPresent` describe the PRIMARY provider (kept for back-compat with callers and
  // hand-built configs). The KEYS are deliberately NOT placed in the resolved config (a security
  // invariant the suite guards); the gateway captures them privately and threads them at call time.
  const model = provider === "gemini" ? geminiModel : openaiModel;
  const apiKeyPresent = provider === "gemini" ? geminiKeyPresent : openaiKeyPresent;

  return {
    provider,
    model,
    networkEnabled,
    apiKeyPresent,
    openaiKeyPresent,
    geminiKeyPresent,
    openaiModel,
    geminiModel,
  };
}

/**
 * Decide which provider runs FIRST. A network provider requires provider≠deterministic AND the
 * network gate AND the primary key; otherwise deterministic. (Fallback ordering is providerChain.)
 */
export function selectProviderMode(config: LlmGatewayConfig): LlmProviderMode {
  if (config.provider !== "deterministic" && config.networkEnabled && config.apiKeyPresent) {
    return config.provider;
  }
  return "deterministic";
}

/**
 * The ordered list of NETWORK providers to try: primary first, then the other one IF its key is
 * present (the fallback). Empty when the network gate is off or no key is present — the gateway
 * then answers deterministically. Hand-built configs that omit openaiKeyPresent/geminiKeyPresent
 * simply get no fallback (the missing flag reads as "key absent").
 */
export function providerChain(config: LlmGatewayConfig): NetworkMode[] {
  if (!config.networkEnabled) return [];
  const order: NetworkMode[] =
    config.provider === "gemini" ? ["gemini", "openai"]
    : config.provider === "openai" ? ["openai", "gemini"]
    : [];
  return order.filter((m) => (m === "gemini" ? config.geminiKeyPresent === true : config.openaiKeyPresent === true));
}

/**
 * Explain the gate decision in one honest, secret-free line — so "no live LLM was used" is never a
 * silent mystery. Returns the resolved mode + the precise reason it's deterministic (or "armed").
 */
export function explainGate(config: LlmGatewayConfig): { mode: LlmProviderMode; reason: string } {
  if (config.provider === "deterministic") {
    return { mode: "deterministic", reason: 'provider is "deterministic" (set HARTOS_LLM_PROVIDER=gemini or openai)' };
  }
  if (!config.networkEnabled) return { mode: "deterministic", reason: "network disabled (set HARTOS_LLM_ENABLE_NETWORK=true)" };
  if (!config.apiKeyPresent) {
    const keyName = config.provider === "gemini" ? "GEMINI_API_KEY" : "OPENAI_API_KEY";
    return { mode: "deterministic", reason: `${keyName} not present in env` };
  }
  return { mode: config.provider, reason: "armed" };
}

export interface LlmGatewayOptions {
  config?: LlmGatewayConfig;
  env?: Env;
  /** Override providers (tests inject mocks). */
  providers?: Partial<Record<LlmProviderMode, LlmProvider>>;
  /** Default false — tests stay quiet. Scripts opt in. */
  writeUsage?: boolean;
  cwd?: string;
  reportsDir?: string;
}

export class LlmGateway {
  readonly config: LlmGatewayConfig;
  private readonly providers: Record<LlmProviderMode, LlmProvider>;
  private readonly writeUsage: boolean;
  private readonly reportsDir: string;
  /**
   * The keys, captured PRIVATELY from env (NOT on the public config). Threaded to the matching
   * provider at call time so the env-injected secret reaches the fetch even when process.env is
   * empty under Worker nodejs_compat. Never logged/serialized; the public `config` stays key-free.
   */
  private readonly apiKey?: string;
  private readonly geminiApiKey?: string;

  constructor(options: LlmGatewayOptions = {}) {
    this.config = options.config ?? resolveLlmConfig(options.env);
    this.providers = {
      deterministic: options.providers?.deterministic ?? deterministicProvider,
      openai: options.providers?.openai ?? openAiProvider,
      gemini: options.providers?.gemini ?? geminiProvider,
    };
    this.writeUsage = options.writeUsage === true;
    const cwd = options.cwd ?? process.cwd();
    this.reportsDir = options.reportsDir ?? path.join(cwd, DEFAULT_LLM_REPORTS_DIR);
    const pick = (v: string | undefined) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
    this.apiKey = pick(options.env?.["OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"]);
    this.geminiApiKey = pick(options.env?.["GEMINI_API_KEY"] ?? process.env["GEMINI_API_KEY"]);
  }

  private async run(type: LlmRequestType, request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    const req: LlmRequest = { type, request, ...(context ? { context } : {}) };
    const chain = providerChain(this.config);

    // Try each network provider in order (primary, then fallback). First valid output wins.
    let result: LlmResult | null = null;
    for (const mode of chain) {
      const attempt = await this.runNetworkProvider(mode, req);
      if (attempt) {
        result = attempt;
        break;
      }
    }
    // No network provider configured ⇒ "deterministic"; chain ran but every provider failed ⇒ "fallback".
    if (!result) {
      result = this.runDeterministic(req, chain.length > 0 ? "fallback" : "deterministic");
    }

    if (this.writeUsage) {
      try {
        await writeUsageLog(this.reportsDir, result);
      } catch {
        // Never let logging break a read-only reasoning call.
      }
    }
    return result;
  }

  private runDeterministic(req: LlmRequest, mode: "deterministic" | "fallback"): LlmResult {
    return {
      output: deterministicOutput(req),
      provider: "deterministic",
      model: this.config.model,
      mode,
      validation: mode === "fallback" ? "fallback" : "valid",
      success: true,
      requestType: req.type,
    };
  }

  /**
   * Run ONE network provider (gemini|openai) with its own model + key threaded in. Returns a valid
   * LlmResult, or null on a provider error / malformed output so `run` can try the next in the chain.
   */
  private async runNetworkProvider(mode: NetworkMode, req: LlmRequest): Promise<LlmResult | null> {
    const model = mode === "gemini" ? (this.config.geminiModel ?? this.config.model) : (this.config.openaiModel ?? this.config.model);
    // Thread BOTH keys (call-time only; never stored on the public config); the provider reads its own.
    const callConfig: LlmGatewayConfig = {
      ...this.config,
      model,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(this.geminiApiKey ? { geminiApiKey: this.geminiApiKey } : {}),
    };
    try {
      const raw = await this.providers[mode].generate(req, callConfig);
      const validation = validateLlmOutput(raw);
      if (validation.ok && validation.value) {
        return {
          output: validation.value,
          provider: mode,
          model,
          mode,
          validation: "valid",
          success: true,
          requestType: req.type,
        };
      }
      return null; // malformed → caller tries the next provider, then deterministic
    } catch {
      return null; // provider error (network/auth/429) → caller tries the next provider
    }
  }

  classifyAndContextualize(request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    return this.run("classify_and_contextualize", request, context);
  }
  runStrategyReasoning(request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    return this.run("strategy_reasoning", request, context);
  }
  runCtoReasoning(request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    return this.run("cto_reasoning", request, context);
  }
  summarizeAgentStatus(request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    return this.run("summarize_agent_status", request, context);
  }
  summarizeCockpitState(request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    return this.run("summarize_cockpit_state", request, context);
  }
  summarizeDataSnapshot(request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    return this.run("summarize_data_snapshot", request, context);
  }

  /**
   * Run a council specialist call. The specialist's lens prompt is passed as the full request string
   * (containing both the system instruction and the user task). The council_specialist requestType
   * triggers an isolated prompt contract + isolated validator (validateCouncilSpecialistOutput),
   * returning LlmCouncilResult — NEVER touching LlmResult or LlmStructuredOutput.
   *
   * Deterministic/fallback mode → output:null (the council treats this as no-real-LLM → honest low stub).
   * Real provider + valid council output → { ok:true, mode, output }.
   * Never throws.
   */
  async runCouncilSpecialist(request: string): Promise<LlmCouncilResult> {
    const req: LlmRequest = { type: "council_specialist", request };
    const chain = providerChain(this.config);

    // Try each network provider in order; validate with the COUNCIL validator.
    for (const mode of chain) {
      const model = mode === "gemini" ? (this.config.geminiModel ?? this.config.model) : (this.config.openaiModel ?? this.config.model);
      const callConfig: LlmGatewayConfig = {
        ...this.config,
        model,
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        ...(this.geminiApiKey ? { geminiApiKey: this.geminiApiKey } : {}),
      };
      try {
        const raw = await this.providers[mode].generate(req, callConfig);
        const validation = validateCouncilSpecialistOutput(raw);
        if (validation.ok && validation.value) {
          return { ok: true, mode, output: validation.value };
        }
        // Malformed — try next provider in chain.
      } catch {
        // Provider error — try next provider in chain.
      }
    }

    // No network provider configured, or all failed.
    // Deterministic path → output:null so the council uses its honest low stub.
    const mode = chain.length > 0 ? "fallback" : "deterministic";
    return { ok: true, mode, output: null };
  }
}
