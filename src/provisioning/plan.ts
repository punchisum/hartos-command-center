/**
 * src/provisioning/plan.ts
 *
 * Build a ProvisionPlan from all provider adapters.
 * No side effects — pure planning only.
 */

import type { ProvisionPlan, ProvisionContext, ProviderAdapter } from "./types.js";

/**
 * Build a complete provision plan by collecting steps from all adapters.
 * The plan is deterministic and has no side effects.
 */
export async function buildProvisionPlan(
  context: ProvisionContext,
  adapters: ProviderAdapter[]
): Promise<ProvisionPlan> {
  const allSteps = (
    await Promise.all(adapters.map((adapter) => adapter.plan(context)))
  ).flat();

  // Assign "planned" status to all steps.
  const steps = allSteps.map((step) => ({ ...step, status: "planned" as const }));

  return {
    agentName: context.agentName,
    environment: context.environment,
    timestamp: new Date().toISOString(),
    steps,
    totalSteps: steps.length,
    mutatingSteps: steps.filter((s) => s.mutation).length,
    readOnlySteps: steps.filter((s) => !s.mutation).length,
  };
}

/**
 * Get all adapters registered for this agent.
 * Dynamically imports each adapter so the plan works with or without env.
 */
export async function getDefaultAdapters(): Promise<ProviderAdapter[]> {
  const [
    { GitHubAdapter },
    { SupabaseAdapter },
    { CloudflareAdapter },
    { TriggerAdapter },
    { TelegramAdapter },
    { OpenAIAdapter },
  ] = await Promise.all([
    import("./adapters/github.js"),
    import("./adapters/supabase.js"),
    import("./adapters/cloudflare.js"),
    import("./adapters/trigger.js"),
    import("./adapters/telegram.js"),
    import("./adapters/openai.js"),
  ]);

  return [
    new GitHubAdapter(),
    new SupabaseAdapter(),
    new CloudflareAdapter(),
    new TriggerAdapter(),
    new TelegramAdapter(),
    new OpenAIAdapter(),
  ];
}

/**
 * Build a context object from the current process environment.
 * Never exposes raw secret values.
 */
export function buildContext(
  agentName: string,
  environment: "local" | "staging" | "production"
): ProvisionContext {
  return {
    agentName,
    environment,
    env: process.env as Record<string, string | undefined>,
  };
}
