/**
 * src/provisioning/adapters/mock.ts
 *
 * Mock adapter — used for testing and as a safe fallback.
 * apply() returns "applied" without any real side effects.
 * Never calls real provider APIs.
 */

import type {
  ProviderAdapter,
  ProviderName,
  ProvisionStep,
  ProvisionStepResult,
  ProvisionContext,
  ProviderVerificationResult,
  RollbackStep,
} from "../types.js";

export class MockAdapter implements ProviderAdapter {
  readonly provider: ProviderName;

  constructor(provider: ProviderName) {
    this.provider = provider;
  }

  async plan(context: ProvisionContext): Promise<ProvisionStep[]> {
    return [
      {
        id: `mock:${this.provider}:run_smoke:${context.environment}`,
        provider: this.provider,
        action: "run_smoke",
        environment: context.environment,
        mutation: false,
        description: `Mock smoke check for ${this.provider}`,
        safeSummary: `Mock read-only check for ${this.provider} — no real provider called`,
        status: "planned",
      },
    ];
  }

  async verify(context: ProvisionContext): Promise<ProviderVerificationResult> {
    return {
      provider: this.provider,
      status: "configured",
      missingEnv: [],
      supportedActions: ["run_smoke"],
      unsupportedActions: [],
      nextAction: "Mock verification passed",
      safeSummary: `Mock adapter for ${this.provider} — no real provider configured`,
    };
  }

  async apply(
    step: ProvisionStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    // Safe mock apply — no real side effects.
    return {
      step: { ...step, status: "applied" },
      status: "applied",
      message: `Mock applied: ${step.id} (no real provider called)`,
      timestamp: new Date().toISOString(),
    };
  }

  async rollback(
    step: RollbackStep,
    _context: ProvisionContext
  ): Promise<ProvisionStepResult> {
    return {
      step: {
        id: "mock:rollback",
        provider: this.provider,
        action: "run_smoke",
        environment: "local",
        mutation: false,
        description: step.description,
        safeSummary: "Mock rollback",
        status: "applied",
      },
      status: "applied",
      message: `Mock rollback: ${step.description} (no real provider called)`,
      timestamp: new Date().toISOString(),
    };
  }
}
