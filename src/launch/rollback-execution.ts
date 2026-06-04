/**
 * src/launch/rollback-execution.ts
 *
 * Gated rollback execution for the production promotion flow.
 * Phase 9: mostly instruction-only unless ALLOW_ROLLBACK_EXECUTION=true.
 *
 * Rules:
 *   - ALLOW_ROLLBACK_EXECUTION=true required for any real rollback
 *   - CONFIRM_PRODUCTION_DEPLOY=true required for production rollback
 *   - Without gates: generate manual instructions only
 *   - Never auto-delete providers or destroy data
 */

import type { ProviderAdapter, RollbackStep } from "../provisioning/types.js";
import type { ProvisionContext } from "../provisioning/types.js";

export interface RollbackStepResult {
  provider: string;
  action: string;
  status: "executed" | "instruction_only" | "gate_missing" | "failed";
  message: string;
}

export interface RollbackExecutionResult {
  gateOpen: boolean;
  steps: RollbackStepResult[];
  summary: string;
}

const ROLLBACK_INSTRUCTIONS: Record<string, string[]> = {
  github: [
    "Archive or delete GitHub repository via dashboard",
    "Remove git remote: git remote remove origin",
  ],
  supabase: [
    "Apply reverting migrations via Supabase CLI or dashboard",
    "Delete project via Supabase dashboard if needed (destructive)",
  ],
  cloudflare: [
    "Rollback Worker: wrangler rollback --env production",
    "Remove secrets: wrangler secret delete <NAME> --env production",
  ],
  telegram: [
    "Remove webhook: set TELEGRAM_WEBHOOK_URL='' and re-register",
    "Or remove via BotFather: /setwebhook",
  ],
  trigger: [
    "Disable tasks via Trigger.dev dashboard",
    "Or: npx trigger.dev@latest disable <task-slug>",
  ],
  openai: ["No rollback needed — OpenAI provisioning is read-only"],
};

export async function executeRollback(
  adapters: ProviderAdapter[],
  context: ProvisionContext
): Promise<RollbackExecutionResult> {
  const gateOpen = context.env["ALLOW_ROLLBACK_EXECUTION"] === "true";
  const steps: RollbackStepResult[] = [];

  for (const adapter of adapters) {
    const instructions = ROLLBACK_INSTRUCTIONS[adapter.provider] ?? [
      `Manual rollback for ${adapter.provider} — consult provider dashboard`,
    ];

    if (!gateOpen) {
      // Instruction-only mode
      steps.push({
        provider: adapter.provider,
        action: "rollback",
        status: "instruction_only",
        message: `Manual: ${instructions[0]}`,
      });
      continue;
    }

    // Gate is open — try adapter rollback
    if (adapter.rollback) {
      const rollbackStep: RollbackStep = {
        description: `Rollback ${adapter.provider} provisioning`,
        notes: "Automated rollback — review before executing",
      };
      try {
        const result = await adapter.rollback(rollbackStep, context);
        steps.push({
          provider: adapter.provider,
          action: "rollback",
          status: result.status === "skipped" ? "instruction_only" : "executed",
          message: result.message.slice(0, 200),
        });
      } catch (err) {
        steps.push({
          provider: adapter.provider,
          action: "rollback",
          status: "failed",
          message: `Rollback error: ${err instanceof Error ? err.message.slice(0, 80) : "unknown"}`,
        });
      }
    } else {
      steps.push({
        provider: adapter.provider,
        action: "rollback",
        status: "instruction_only",
        message: `Manual: ${instructions[0]}`,
      });
    }
  }

  const executed = steps.filter((s) => s.status === "executed").length;
  const instructionOnly = steps.filter((s) => s.status === "instruction_only").length;

  return {
    gateOpen,
    steps,
    summary: gateOpen
      ? `Rollback: ${executed} executed, ${instructionOnly} manual instructions`
      : `Rollback instructions generated. Set ALLOW_ROLLBACK_EXECUTION=true to execute.`,
  };
}

export function formatRollbackInstructions(providers: string[]): string {
  const lines = ["# Rollback Instructions", ""];
  for (const provider of providers) {
    const instructions = ROLLBACK_INSTRUCTIONS[provider] ?? [
      `Manually rollback ${provider} via its dashboard`,
    ];
    lines.push(`## ${provider}`);
    for (const inst of instructions) {
      lines.push(`- ${inst}`);
    }
    lines.push("");
  }
  return lines.join("\n") + "\n";
}
