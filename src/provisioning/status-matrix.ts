/**
 * src/provisioning/status-matrix.ts
 *
 * Build and format a provider status matrix.
 * Shows each provider's configuration status, supported actions, and next step.
 * Never prints secrets.
 */

import type {
  ProviderAdapter,
  ProviderVerificationResult,
  ProvisionContext,
} from "./types.js";

export interface StatusMatrix {
  agentName: string;
  environment: string;
  timestamp: string;
  providers: ProviderVerificationResult[];
  configuredCount: number;
  missingEnvCount: number;
  notImplementedCount: number;
}

export async function buildStatusMatrix(
  adapters: ProviderAdapter[],
  context: ProvisionContext
): Promise<StatusMatrix> {
  const providers = await Promise.all(
    adapters.map((adapter) => adapter.verify(context))
  );

  return {
    agentName: context.agentName,
    environment: context.environment,
    timestamp: new Date().toISOString(),
    providers,
    configuredCount: providers.filter((p) => p.status === "configured").length,
    missingEnvCount: providers.filter((p) => p.status === "missing_env").length,
    notImplementedCount: providers.filter((p) => p.status === "not_implemented").length,
  };
}

export function formatStatusMatrix(matrix: StatusMatrix): string {
  const lines: string[] = [
    `Provider readiness: ${matrix.agentName} (${matrix.environment})`,
    `Generated: ${matrix.timestamp}`,
    ``,
  ];

  const maxProvider = Math.max(...matrix.providers.map((p) => p.provider.length));

  for (const p of matrix.providers) {
    const pad = " ".repeat(maxProvider - p.provider.length + 2);
    const statusIcon =
      p.status === "configured" ? "✓" : p.status === "missing_env" ? "✗" : "○";
    lines.push(`${statusIcon} ${p.provider}${pad}${p.status}`);

    if (p.missingEnv.length > 0) {
      lines.push(`  missing: ${p.missingEnv.join(", ")}`);
    }
    if (p.supportedActions.length > 0) {
      lines.push(`  supported: ${p.supportedActions.join(", ")}`);
    }
    if (p.unsupportedActions.length > 0) {
      lines.push(`  phase 7: ${p.unsupportedActions.join(", ")}`);
    }
    lines.push(`  next: ${p.nextAction}`);
    lines.push(``);
  }

  lines.push(`Summary`);
  lines.push(`  Configured:     ${matrix.configuredCount}`);
  lines.push(`  Missing env:    ${matrix.missingEnvCount}`);
  lines.push(`  Not implemented: ${matrix.notImplementedCount}`);

  return lines.join("\n") + "\n";
}
