/**
 * src/llm/llm-gateway.ts
 *
 * The governed LLM Gateway. Every module that wants LLM reasoning goes through
 * here — never directly to a provider. Architecture:
 *
 *   caller → LlmGateway → provider adapter (openai|deterministic)
 *                       → output validator → safe structured result
 *
 * Defaults to the deterministic provider. OpenAI is selected only when
 * HARTOS_LLM_PROVIDER=openai AND HARTOS_LLM_ENABLE_NETWORK=true AND an API key
 * is present. Malformed provider output falls back to deterministic — it never
 * crashes. Optionally writes a redacted usage log.
 */

import path from "node:path";
import type {
  LlmGatewayConfig,
  LlmProvider,
  LlmProviderMode,
  LlmRequest,
  LlmRequestType,
  LlmResult,
} from "./llm-types.js";
import { deterministicProvider, deterministicOutput } from "./providers/deterministic-provider.js";
import { openAiProvider } from "./providers/openai-provider.js";
import { validateLlmOutput } from "./output-validator.js";
import { DEFAULT_LLM_REPORTS_DIR, writeUsageLog } from "./usage-log.js";

export const DEFAULT_MODEL = "gpt-4o-mini";

type Env = Record<string, string | undefined>;

/** Resolve gateway configuration from environment. Never exposes the key. */
export function resolveLlmConfig(env: Env = process.env): LlmGatewayConfig {
  const providerRaw = (env["HARTOS_LLM_PROVIDER"] ?? "deterministic").toLowerCase();
  const provider: LlmProviderMode = providerRaw === "openai" ? "openai" : "deterministic";
  const networkEnabled = env["HARTOS_LLM_ENABLE_NETWORK"] === "true";
  const apiKey = env["OPENAI_API_KEY"];
  const apiKeyPresent = typeof apiKey === "string" && apiKey.trim().length > 0;
  const model = env["HARTOS_LLM_MODEL"]?.trim() || DEFAULT_MODEL;
  return { provider, model, networkEnabled, apiKeyPresent };
}

/**
 * Decide which provider actually runs. OpenAI requires provider=openai AND the
 * network gate AND a key; otherwise deterministic. This is the single gate.
 */
export function selectProviderMode(config: LlmGatewayConfig): LlmProviderMode {
  if (config.provider === "openai" && config.networkEnabled && config.apiKeyPresent) {
    return "openai";
  }
  return "deterministic";
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

  constructor(options: LlmGatewayOptions = {}) {
    this.config = options.config ?? resolveLlmConfig(options.env);
    this.providers = {
      deterministic: options.providers?.deterministic ?? deterministicProvider,
      openai: options.providers?.openai ?? openAiProvider,
    };
    this.writeUsage = options.writeUsage === true;
    const cwd = options.cwd ?? process.cwd();
    this.reportsDir = options.reportsDir ?? path.join(cwd, DEFAULT_LLM_REPORTS_DIR);
  }

  private async run(type: LlmRequestType, request: string, context?: Record<string, unknown>): Promise<LlmResult> {
    const req: LlmRequest = { type, request, ...(context ? { context } : {}) };
    const mode = selectProviderMode(this.config);

    let result: LlmResult;
    if (mode === "openai") {
      result = await this.runOpenAi(req);
    } else {
      result = this.runDeterministic(req, "deterministic");
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

  private async runOpenAi(req: LlmRequest): Promise<LlmResult> {
    try {
      const raw = await this.providers.openai.generate(req, this.config);
      const validation = validateLlmOutput(raw);
      if (validation.ok && validation.value) {
        return {
          output: validation.value,
          provider: "openai",
          model: this.config.model,
          mode: "openai",
          validation: "valid",
          success: true,
          requestType: req.type,
        };
      }
      // Malformed → safe deterministic fallback.
      return this.runDeterministic(req, "fallback");
    } catch {
      // Provider error (network/auth/etc.) → safe deterministic fallback.
      return this.runDeterministic(req, "fallback");
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
}
