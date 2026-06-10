/**
 * src/wolverine/detectors/unsafe-flags.ts
 *
 * Wolverine detector — armed execution / deploy / migration flags. Pure.
 *
 * HartOS keeps every dangerous capability behind a default-OFF flag (the per-action
 * ALLOW_EXEC_* allowlist, the Cloudflare deploy gates, the migration-apply gate). The safe
 * floor is "all disarmed". A flag left =true after use means a real-world write/deploy can
 * fire without the deliberate arming step — exactly what Wolverine should surface before Hart
 * has to remember to check.
 */

import type { WolverineFinding, WolverineInputs, WolverineSeverity } from "../wolverine-types.js";

interface FlagSpec {
  name: string;
  severity: WolverineSeverity;
  meaning: string;
}

/** The dangerous flags Wolverine watches. Armed (=true) ⇒ a finding. */
const WATCHED_FLAGS: FlagSpec[] = [
  { name: "ALLOW_EXEC_CLICKUP_COMMENT", severity: "high", meaning: "live ClickUp comment writes can fire" },
  { name: "ALLOW_EXEC_CLICKUP_MOVE", severity: "high", meaning: "live ClickUp status moves can fire" },
  { name: "ALLOW_EXEC_REFRESH_SYNC", severity: "medium", meaning: "the refresh-sync mutation can fire (internal, reversible)" },
  { name: "ALLOW_EXEC_REJECT_DRAFTS", severity: "medium", meaning: "bulk draft-rejection can fire" },
  { name: "ALLOW_EXEC_ARCHIVE_REJECTED", severity: "medium", meaning: "bulk archive can fire" },
  { name: "ALLOW_EXEC_MARK_REVIEWED", severity: "medium", meaning: "mark-reviewed writes can fire" },
  { name: "CONFIRM_CLOUDFLARE_DEPLOY", severity: "high", meaning: "a Cloudflare deploy gate is open" },
  { name: "ALLOW_CLOUDFLARE_COCKPIT_DEPLOY", severity: "high", meaning: "a Cloudflare deploy gate is open" },
  { name: "ALLOW_AUTO_PROVISION", severity: "high", meaning: "auto-provisioning of infra is enabled" },
  { name: "ALLOW_SUPABASE_MIGRATION_APPLY", severity: "high", meaning: "live Supabase migrations can be applied" },
];

function isArmed(v: string | undefined): boolean {
  return String(v ?? "").trim().toLowerCase() === "true";
}

export const UNSAFE_FLAGS_DETECTOR = "unsafe-flags";

export function detectUnsafeFlags(inputs: WolverineInputs): WolverineFinding[] {
  const env = inputs.env ?? {};
  const killSwitchOn = String(env["HARTOS_EXECUTION_KILL_SWITCH"] ?? "").trim().toLowerCase() === "on";
  const out: WolverineFinding[] = [];

  for (const flag of WATCHED_FLAGS) {
    if (!isArmed(env[flag.name])) continue;
    const isExec = flag.name.startsWith("ALLOW_EXEC_");
    // The global kill-switch neutralises the per-action exec flags (not deploy/migration).
    const neutralised = isExec && killSwitchOn;
    out.push({
      id: `unsafe-flag:${flag.name}`,
      category: "unsafe_flag",
      severity: neutralised ? "low" : flag.severity,
      title: `Capability flag left armed: ${flag.name}`,
      evidence: `${flag.name}=true — ${flag.meaning}${neutralised ? " (kill-switch ON neutralises it for now)" : ""}.`,
      ownerAgent: "HartOS execution floor",
      recommendedFix: `Disarm: set ${flag.name}=false in .env.local (re-arm only at the moment you fire).`,
      blastRadius: "Config-only — affects whether the gated action can execute; no data change to disarm.",
      rollbackPath: `Re-arm by setting ${flag.name}=true again.`,
      approvalRequired: false,
      confidence: "high",
      freshness: "env (current process), as of run",
      source: UNSAFE_FLAGS_DETECTOR,
    });
  }
  return out;
}
