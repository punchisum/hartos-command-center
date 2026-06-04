/**
 * src/provisioning/gates.ts
 *
 * Gate checking for the provisioning engine.
 *
 * Rules:
 *   - provision:plan never requires gates (read-only).
 *   - provision:auto requires ALLOW_AUTO_PROVISION=true.
 *   - staging also requires CONFIRM_STAGING_PROVISION=true.
 *   - production also requires CONFIRM_PRODUCTION_DEPLOY=true.
 *   - provider-specific mutating steps require their provider gate.
 *   - Missing gate = skip step safely, report gate name.
 */

import type { ProvisionEnvironment, ProvisionStep } from "./types.js";

export interface GateCheckResult {
  allowed: boolean;
  missingGates: string[];
  message: string;
}

// ─── Global auto-provision gate ───────────────────────────────────────────────

export function checkAutoProvisionGate(
  env: Record<string, string | undefined>
): GateCheckResult {
  const missing: string[] = [];
  if (env["ALLOW_AUTO_PROVISION"] !== "true") missing.push("ALLOW_AUTO_PROVISION");
  if (missing.length > 0) {
    return {
      allowed: false,
      missingGates: missing,
      message:
        "Auto-provision is gated. Set ALLOW_AUTO_PROVISION=true to proceed.",
    };
  }
  return { allowed: true, missingGates: [], message: "Auto-provision gate open." };
}

// ─── Environment gate ─────────────────────────────────────────────────────────

export function checkEnvironmentGate(
  env: Record<string, string | undefined>,
  environment: ProvisionEnvironment
): GateCheckResult {
  if (environment === "staging") {
    if (env["CONFIRM_STAGING_PROVISION"] !== "true") {
      return {
        allowed: false,
        missingGates: ["CONFIRM_STAGING_PROVISION"],
        message:
          "Staging provision requires CONFIRM_STAGING_PROVISION=true.",
      };
    }
  }
  if (environment === "production") {
    if (env["CONFIRM_PRODUCTION_DEPLOY"] !== "true") {
      return {
        allowed: false,
        missingGates: ["CONFIRM_PRODUCTION_DEPLOY"],
        message:
          "Production provision requires CONFIRM_PRODUCTION_DEPLOY=true.",
      };
    }
  }
  return { allowed: true, missingGates: [], message: `${environment} environment gate open.` };
}

// ─── Per-step gate ────────────────────────────────────────────────────────────

export function checkStepGate(
  step: ProvisionStep,
  env: Record<string, string | undefined>
): GateCheckResult {
  // Read-only steps never require a gate.
  if (!step.mutation) {
    return { allowed: true, missingGates: [], message: "Read-only step — no gate required." };
  }

  const missing: string[] = [];

  if (step.requiredGate && env[step.requiredGate] !== "true") {
    missing.push(step.requiredGate);
  }
  if (step.productionGateRequired && env["CONFIRM_PRODUCTION_DEPLOY"] !== "true") {
    missing.push("CONFIRM_PRODUCTION_DEPLOY");
  }

  if (missing.length > 0) {
    return {
      allowed: false,
      missingGates: missing,
      message: `Step "${step.id}" requires gates: ${missing.join(", ")}. Set them to proceed.`,
    };
  }

  return { allowed: true, missingGates: [], message: `Step "${step.id}" gate open.` };
}

// ─── Combined gate check for auto-provision ───────────────────────────────────

export function checkAllAutoGates(
  env: Record<string, string | undefined>,
  environment: ProvisionEnvironment
): GateCheckResult {
  const global = checkAutoProvisionGate(env);
  if (!global.allowed) return global;

  const envGate = checkEnvironmentGate(env, environment);
  if (!envGate.allowed) return envGate;

  return { allowed: true, missingGates: [], message: "All auto-provision gates open." };
}

// ─── Gate summary for display ─────────────────────────────────────────────────

export interface GateSummary {
  gateName: string;
  open: boolean;
  note: string;
}

export function buildGateSummary(
  env: Record<string, string | undefined>,
  environment: ProvisionEnvironment
): GateSummary[] {
  const gateNames = [
    "ALLOW_AUTO_PROVISION",
    "CONFIRM_STAGING_PROVISION",
    "CONFIRM_PRODUCTION_DEPLOY",
    "ALLOW_GITHUB_PROVISION",
    "ALLOW_SUPABASE_PROVISION",
    "ALLOW_CLOUDFLARE_PROVISION",
    "ALLOW_TRIGGER_PROVISION",
    "ALLOW_TELEGRAM_PROVISION",
    "ALLOW_OPENAI_VERIFY",
  ];

  return gateNames
    .filter((name) => {
      // Only show relevant gates for the environment.
      if (name === "CONFIRM_STAGING_PROVISION" && environment !== "staging") return false;
      if (name === "CONFIRM_PRODUCTION_DEPLOY" && environment !== "production") return false;
      return true;
    })
    .map((name) => ({
      gateName: name,
      open: env[name] === "true",
      note:
        env[name] === "true"
          ? "open"
          : `set ${name}=true to enable`,
    }));
}
