/**
 * src/cockpit/agent-planner/birth-runway.ts
 *
 * Turns a dry-run AgentCreationPlan into the ORDERED, GATED RUNWAY to a live agent — the exact
 * sequence of commands + the flag that arms each. This is what makes "agent auto-birth" a SINGLE
 * legible command (factory:birth) instead of "which of a dozen scripts, in what order, with which
 * flags?" — WITHOUT crossing the approval floor: it only DESCRIBES the runway; every mutating step
 * stays individually gated and human-run. PURE: no I/O, no mutation.
 */

import type { AgentCreationPlan } from "./agent-planner.js";

export interface RunwayStep {
  order: number;
  title: string;
  /** The exact command to run (gate prefix included). `<id>` = the approved cockpit proposal id. */
  command: string;
  /** What arms/blocks this step. */
  gate: string;
  /** True when the step mutates a provider / pushes / deploys (needs explicit approval). */
  mutation: boolean;
  note: string;
}

/**
 * Build the birth runway from a plan. Steps are ordered scaffold → push → data → runtime → extras →
 * the hand-built per-domain adapter (the honest "this part is real engineering" step). Mutating
 * provider steps are taken verbatim from the plan's providerPlan so the gates are never invented.
 */
export function birthRunway(plan: AgentCreationPlan): RunwayStep[] {
  const steps: RunwayStep[] = [];
  let order = 1;
  const find = (provider: string) => plan.providerPlan.find((p) => p.provider === provider);

  steps.push({
    order: order++,
    title: "Scaffold the agent repo locally (no push)",
    command: "ALLOW_LOCAL_SCAFFOLD=true npm run agent:scaffold-build -- --id=<id>",
    gate: "ALLOW_LOCAL_SCAFFOLD",
    mutation: false,
    note: "Writes a local PR bundle (chassis: cockpit shell, LLM gateway, audit tables). Nothing pushed/deployed.",
  });
  steps.push({
    order: order++,
    title: "Open the PR (push to GitHub)",
    command: "npm run agent:scaffold-pr -- --id=<id>",
    gate: "headless GitHub auth (PAT/SSH) — the keystone",
    mutation: true,
    note: "Requires the push to work non-interactively.",
  });

  const supa = find("supabase");
  if (supa) {
    steps.push({
      order: order++,
      title: "Provision the agent database",
      command: `${supa.gate}=true npm run agent:data-provision -- --id=<id>`,
      gate: supa.gate,
      mutation: true,
      note: supa.reason,
    });
  }
  const cf = find("cloudflare");
  if (cf) {
    steps.push({
      order: order++,
      title: "Deploy the hosted cockpit",
      command: `${cf.gate}=true npm run agent:runtime-provision -- --id=<id>`,
      gate: cf.gate,
      mutation: true,
      note: cf.reason,
    });
  }
  for (const extra of plan.providerPlan.filter((p) => p.mutation && !["supabase", "cloudflare", "github"].includes(p.provider))) {
    steps.push({
      order: order++,
      title: `Provision ${extra.provider}`,
      command: `${extra.gate}=true npm run provision:auto -- --env=production`,
      gate: extra.gate,
      mutation: true,
      note: extra.reason,
    });
  }

  // The honest last mile: a new domain renders as a generic "degraded" cockpit card until a
  // type-specific adapter + data source is hand-built (this is the real per-domain engineering).
  steps.push({
    order: order++,
    title: "Hand-wire the data source + a type-specific cockpit adapter",
    command: "(engineering — mirror src/cockpit/sources/fitness-source.ts + an ingestion path)",
    gate: "engineering (not a flag)",
    mutation: false,
    note: "Until this exists the agent shows a generic read-only card. This is where the domain's real value is built.",
  });

  return steps;
}
