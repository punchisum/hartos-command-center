/**
 * src/provisioning/adapters/openai.ts
 *
 * OpenAI provider adapter — Phase 7A real verification.
 *
 * plan():    Returns read-only verify_model step.
 * verify():  Checks OPENAI_API_KEY. If ALLOW_OPENAI_VERIFY=true, calls
 *            GET /v1/models/{model} to confirm key + model access.
 * apply():   Not called for read-only steps (engine calls verify() instead).
 * rollback(): No rollback needed — no infrastructure created.
 *
 * Security rules:
 *   - OPENAI_API_KEY is NEVER printed, logged, or included in messages.
 *   - Authorization header is NEVER logged.
 *   - No prompt content, repo files, or business data is sent to OpenAI.
 *   - API errors are sanitized (status code only, no response body in logs).
 */

import type {
  ProviderAdapter,
  ProvisionStep,
  ProvisionContext,
  ProviderVerificationResult,
} from "../types.js";

const OPENAI_API = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o";

/** Never log or include the API key value in messages. */
function makeHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

export class OpenAIAdapter implements ProviderAdapter {
  readonly provider = "openai" as const;
  private readonly fetchImpl: typeof fetch;

  constructor(fetchImpl: typeof fetch = fetch) {
    this.fetchImpl = fetchImpl;
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    return [
      {
        id: `openai:verify_model:${context.environment}`,
        provider: "openai",
        action: "verify_model",
        environment: context.environment,
        mutation: false,
        requiredGate: "ALLOW_OPENAI_VERIFY",
        description: "Verify OpenAI API key and configured model access",
        safeSummary:
          "Read-only: calls GET /v1/models/{model} when ALLOW_OPENAI_VERIFY=true. " +
          "Never sends prompts or repo content.",
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    const apiKey = context.env["OPENAI_API_KEY"];
    const model = context.env["OPENAI_MODEL"] ?? DEFAULT_MODEL;

    if (!apiKey) {
      return {
        provider: "openai",
        status: "missing_env",
        missingEnv: ["OPENAI_API_KEY"],
        supportedActions: ["verify_model"],
        unsupportedActions: [],
        nextAction: "Set OPENAI_API_KEY to configure OpenAI",
        safeSummary: "OpenAI not configured — OPENAI_API_KEY missing",
      };
    }

    // If gate is not open, return configured without API call
    if (context.env["ALLOW_OPENAI_VERIFY"] !== "true") {
      return {
        provider: "openai",
        status: "configured",
        missingEnv: [],
        supportedActions: ["verify_model"],
        unsupportedActions: [],
        nextAction:
          "Set ALLOW_OPENAI_VERIFY=true and run provision:auto to verify model access",
        safeSummary: `OpenAI configured (key present). Set ALLOW_OPENAI_VERIFY=true to ping ${model}`,
      };
    }

    // Gate is open — call the API
    const verifyResult = await this.verifyModelAccess(apiKey, model);
    return verifyResult;
  }

  // ─── Private verify helper ────────────────────────────────────────────────

  private async verifyModelAccess(
    apiKey: string,
    model: string
  ): Promise<ProviderVerificationResult> {
    try {
      // Use GET /v1/models/{model_id} — lightweight, read-only, no tokens sent
      const res = await this.fetchImpl(`${OPENAI_API}/models/${model}`, {
        method: "GET",
        headers: makeHeaders(apiKey),
      });

      if (res.status === 200) {
        return {
          provider: "openai",
          status: "configured",
          missingEnv: [],
          supportedActions: ["verify_model"],
          unsupportedActions: [],
          nextAction: "OpenAI model verified. Ready for LLM calls.",
          safeSummary: `OpenAI configured. Model ${model} accessible`,
        };
      }

      if (res.status === 401) {
        return {
          provider: "openai",
          status: "error",
          missingEnv: [],
          supportedActions: [],
          unsupportedActions: ["verify_model"],
          nextAction: "Check OPENAI_API_KEY is valid",
          safeSummary: "OpenAI API key rejected (HTTP 401). Key may be invalid or expired.",
        };
      }

      if (res.status === 404) {
        return {
          provider: "openai",
          status: "error",
          missingEnv: [],
          supportedActions: [],
          unsupportedActions: ["verify_model"],
          nextAction: `Check OPENAI_MODEL — "${model}" may not be accessible with this key`,
          safeSummary: `OpenAI model "${model}" not found (HTTP 404)`,
        };
      }

      return {
        provider: "openai",
        status: "error",
        missingEnv: [],
        supportedActions: [],
        unsupportedActions: ["verify_model"],
        nextAction: "Check OpenAI API status and key permissions",
        safeSummary: `OpenAI verify failed with HTTP ${res.status}`,
      };
    } catch (err) {
      const msg =
        err instanceof Error ? err.message.slice(0, 80) : "unknown";
      return {
        provider: "openai",
        status: "error",
        missingEnv: [],
        supportedActions: [],
        unsupportedActions: ["verify_model"],
        nextAction: "Check network connectivity and OpenAI API status",
        safeSummary: `OpenAI verify network error: ${msg}`,
      };
    }
  }
}
