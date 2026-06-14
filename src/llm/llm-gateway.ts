/**
 * src/llm/llm-gateway.ts
 *
 * The governed LLM Gateway. Every module that wants LLM reasoning goes through
 * here — never directly to a provider. Architecture:
 *
 *   caller → LlmGateway → provider CHAIN (claude-max → gemini → openai → deterministic)
 *                       → output validator → safe structured result
 *
 * Defaults to the deterministic provider. A network provider is selected only when
 * HARTOS_LLM_PROVIDER=gemini|openai AND HARTOS_LLM_ENABLE_NETWORK=true AND that
 * provider's key is present. The PRIMARY provider is tried first; if it errors or
 * returns malformed output, the OTHER network provider (whose key is present) is
 * tried as a fallback; if that also fails, the deterministic provider answers. It
 * never crashes. Optionally writes a redacted usage log.
 *
 * claude-max is a HOST-ONLY provider (requires node:child_process). To use it,
 * pass `extraProviders: { "claude-max": claudeMaxProvider }` via LlmGatewayOptions
 * and set `config.provider = "claude-max"`. Use `buildHostGateway` from
 * host-gateway.ts (also host-only) for convenience. The Worker never passes this
 * option so the Worker import graph stays clean.
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

/**
 * Network providers the gateway may call. "claude-max" is host-only (node:child_process);
 * it is only reachable when injected via extraProviders and provider="claude-max".
 */
type NetworkMode = "claude-max" | "gemini" | "openai";

type Env = Record<string, string | undefined>;

/** Resolve gateway configuration from environment. Never exposes either key. */
export function resolveLlmConfig(env: Env = process.env): LlmGatewayConfig {
  const providerRaw = (env["HARTOS_LLM_PROVIDER"] ?? "deterministic").toLowerCase();
  const provider: LlmProviderMode =
    providerRaw === "gemini" ? "gemini"
    : providerRaw === "openai" ? "openai"
    : providerRaw === "claude-max" ? "claude-max"
    : "deterministic";
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
 * "claude-max" is special: apiKeyPresent is not applicable (it uses CLAUDE_CODE_OAUTH_TOKEN).
 * For claude-max the gateway trusts the chain to self-gate via the provider throwing on no-token.
 */
export function selectProviderMode(config: LlmGatewayConfig): LlmProviderMode {
  if (config.provider === "claude-max") {
    // claude-max does not use networkEnabled / apiKeyPresent (those describe API-key providers).
    // The chain gates itself: if the token is absent the provider throws → falls to gemini.
    return "claude-max";
  }
  if (config.provider !== "deterministic" && config.networkEnabled && config.apiKeyPresent) {
    return config.provider;
  }
  return "deterministic";
}

/**
 * The ordered list of NETWORK providers to try: primary first, then fallbacks.
 *
 * claude-max chain: ["claude-max", "gemini", "openai"] filtered by:
 *   - "claude-max" eligible iff it is present in the providers map (passed at construction;
 *     checked via the `claudeMaxPresent` flag threaded from the constructor).
 *   - "gemini" / "openai" eligible as usual (key flags).
 * claude-max does NOT require networkEnabled — it gates itself on CLAUDE_CODE_OAUTH_TOKEN.
 * Gemini/OpenAI fallbacks still require networkEnabled + their key.
 *
 * gemini/openai chains: unchanged (networkEnabled + key flags).
 *
 * Hand-built configs that omit openaiKeyPresent/geminiKeyPresent get no fallback
 * for those providers (the missing flag reads as "key absent").
 */
export function providerChain(
  config: LlmGatewayConfig,
  opts: { claudeMaxPresent?: boolean } = {},
): NetworkMode[] {
  if (config.provider === "claude-max") {
    // Primary = claude-max (host-only). Fallbacks require the network gate + their key.
    const chain: NetworkMode[] = [];
    if (opts.claudeMaxPresent) chain.push("claude-max");
    if (config.networkEnabled && config.geminiKeyPresent === true) chain.push("gemini");
    if (config.networkEnabled && config.openaiKeyPresent === true) chain.push("openai");
    return chain;
  }
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
  if (config.provider === "claude-max") {
    // claude-max is always "armed" at the config level; it self-gates on the OAuth token.
    return { mode: "claude-max", reason: "armed (claude-max host-only; gates on CLAUDE_CODE_OAUTH_TOKEN)" };
  }
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
  /**
   * Extra providers to merge on top of the defaults. Intended for HOST-ONLY providers that must
   * never appear in the Worker bundle (e.g. "claude-max" which imports node:child_process). Host
   * callers pass `extraProviders: hostExtraProviders(env)` from host-gateway.ts; the Worker never
   * passes this option so the Worker import graph stays node:child_process-free.
   *
   * Merge order: `extraProviders` is applied first, then `providers` (so test mocks still win).
   */
  extraProviders?: Partial<Record<LlmProviderMode, LlmProvider>>;
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
  /** True iff a "claude-max" provider was wired in (via providers or extraProviders). */
  private readonly claudeMaxPresent: boolean;

  constructor(options: LlmGatewayOptions = {}) {
    this.config = options.config ?? resolveLlmConfig(options.env);

    // Merge order: extraProviders (host-only) → defaults → providers (test mocks, highest priority).
    // The "claude-max" slot defaults to undefined (no provider = no spawn = Worker stays clean).
    const merged: Record<LlmProviderMode, LlmProvider> = {
      deterministic: deterministicProvider,
      openai: openAiProvider,
      gemini: geminiProvider,
      // "claude-max" has no default — only present when the HOST explicitly wires it in.
      ...(options.extraProviders ?? {}),
      ...(options.providers ?? {}),
    } as Record<LlmProviderMode, LlmProvider>;

    this.providers = merged;
    this.claudeMaxPresent = "claude-max" in merged && merged["claude-max"] != null;

    this.writeUsage = options.writeUsage === true;
    const cwd = options.cwd ?? process.cwd();
    this.reportsDir = options.reportsDir ?? path.join(cwd, DEFAULT_LLM_REPORTS_DIR);
    const pick = (v: string | undefined) => (typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined);
    this.apiKey = pick(options.env?.["OPENAI_API_KEY"] ?? process.env["OPENAI_API_KEY"]);
    this.geminiApiKey = pick(options.env?.["GEMINI_API_KEY"] ?? process.env["GEMINI_API_KEY"]);
  }

  private async run(type: LlmRequestType, request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    const req: LlmRequest = { type, request, ...(context ? { context } : {}) };
    const chain = providerChain(this.config, { claudeMaxPresent: this.claudeMaxPresent });

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
   * Run ONE network provider (claude-max|gemini|openai) with its own model + key threaded in.
   * Returns a valid LlmResult, or null on a provider error / malformed output so `run` can try
   * the next in the chain.
   *
   * claude-max: reads CLAUDE_CODE_OAUTH_TOKEN directly from process.env (the provider handles
   * this internally). No API key is threaded — that's an API-key-provider concern.
   */
  private async runNetworkProvider(mode: NetworkMode, req: LlmRequest): Promise<LlmResult | null> {
    // claude-max uses process.env token internally — no model/key threading needed here.
    const model =
      mode === "claude-max"
        ? (process.env["HARTOS_LLM_MODEL"] ?? "sonnet")
        : mode === "gemini"
          ? (this.config.geminiModel ?? this.config.model)
          : (this.config.openaiModel ?? this.config.model);

    // Thread BOTH API keys (call-time only; never stored on the public config); the provider reads its own.
    // claude-max ignores these — it uses CLAUDE_CODE_OAUTH_TOKEN.
    const callConfig: LlmGatewayConfig = {
      ...this.config,
      model,
      ...(this.apiKey ? { apiKey: this.apiKey } : {}),
      ...(this.geminiApiKey ? { geminiApiKey: this.geminiApiKey } : {}),
    };

    const provider = this.providers[mode];
    if (!provider) return null; // provider not wired (e.g. claude-max not injected) → skip

    try {
      const raw = await provider.generate(req, callConfig);
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
      return null; // provider error (network/auth/429/token-absent) → caller tries next provider
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
    const chain = providerChain(this.config, { claudeMaxPresent: this.claudeMaxPresent });

    // Try each network provider in order; validate with the COUNCIL validator.
    for (const mode of chain) {
      const provider = this.providers[mode];
      if (!provider) continue; // not wired — skip

      const model =
        mode === "claude-max"
          ? (process.env["HARTOS_LLM_MODEL"] ?? "sonnet")
          : mode === "gemini"
            ? (this.config.geminiModel ?? this.config.model)
            : (this.config.openaiModel ?? this.config.model);
      const callConfig: LlmGatewayConfig = {
        ...this.config,
        model,
        ...(this.apiKey ? { apiKey: this.apiKey } : {}),
        ...(this.geminiApiKey ? { geminiApiKey: this.geminiApiKey } : {}),
      };
      try {
        const raw = await provider.generate(req, callConfig);
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
