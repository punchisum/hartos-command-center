/**
 * src/hartos/auto-orchestrator.ts — the ASYNC multi-agent orchestration runtime (T4).
 *
 * Today HartOS's "multi-domain collaboration" is propose-only/human-spliced: an operator runs the
 * Research CLI, copies the dossier, runs Beezulbub, copies the scout report, then hand-feeds both to
 * a planner. No runtime passes one agent's OUTPUT into the next agent's INPUT automatically. This
 * module is exactly that runtime: a gated, async pipeline where each step CONSUMES the prior step's
 * artifact —
 *
 *     request → research(request) → scout(request, researchArtifact) → plan(request, research, scout)
 *
 * It stays propose-only: the output is a composed BUILD PLAN / dossier for Hart's review, never an
 * execution. Each sub-step keeps its OWN gates (research-gather, beezulbub-network, obsidian-write);
 * this runtime adds ONE class gate (ALLOW_AUTO_ORCHESTRATE) controlling whether the automatic
 * handoff runs at all — disarmed, it returns an honest dry plan and invokes no agent. Generic over
 * injected steps (the real research/scout/plan wiring lives in scripts/auto-orchestrate.ts), so the
 * orchestration LOGIC — ordering, gating, artifact threading, fail-soft — is pure + unit-testable.
 */

export const AUTO_ORCHESTRATE_FLAG = "ALLOW_AUTO_ORCHESTRATE";

export interface StepResult {
  step: string;
  ok: boolean;
  summary: string;
  /** The artifact handed to the NEXT step (the agent-to-agent handoff). null on skip/fail. */
  artifact: unknown;
}

/**
 * The three composable agents. Each is async and receives the PRIOR step's artifact, so a later
 * agent reasons over an earlier agent's real output. Injected so the runtime is testable with fakes.
 */
export interface OrchestrationSteps {
  research(request: string, env: Record<string, string | undefined>, now: string): Promise<StepResult>;
  scout(request: string, research: unknown, env: Record<string, string | undefined>, now: string): Promise<StepResult>;
  plan(request: string, research: unknown, scout: unknown, env: Record<string, string | undefined>, now: string): Promise<StepResult>;
}

export interface OrchestrationResult {
  request: string;
  armed: boolean;
  ran: boolean;
  steps: StepResult[];
  lines: string[];
}

export function autoOrchestrateArmed(env: Record<string, string | undefined>): boolean {
  return String(env[AUTO_ORCHESTRATE_FLAG] ?? "").trim().toLowerCase() === "true";
}

/** Wrap a step so a thrown/rejected step degrades to an honest skip — the pipeline never crashes. */
async function safeStep(step: string, fn: () => Promise<StepResult>): Promise<StepResult> {
  try {
    const res = await fn();
    return { ...res, step };
  } catch (e) {
    return { step, ok: false, summary: `failed: ${e instanceof Error ? e.message : String(e)}`, artifact: null };
  }
}

function line(r: StepResult): string {
  return `  • ${r.step}: ${r.ok ? "ok" : "skip/fail"} — ${r.summary}`;
}

/**
 * Run the gated research → scout → plan pipeline, threading each artifact into the next step. A
 * failed/skipped step yields a null artifact but does NOT stop the pipeline — the next agent simply
 * reasons over what it has (honest degradation). Propose-only: returns the composed result for
 * review; nothing is executed. Disarmed (default) returns a dry plan and invokes no agent.
 */
export async function runAutoOrchestration(input: {
  request: string;
  env: Record<string, string | undefined>;
  now: string;
  steps: OrchestrationSteps;
}): Promise<OrchestrationResult> {
  const { request, env, now, steps } = input;
  const armed = autoOrchestrateArmed(env);
  const lines: string[] = [];

  if (!request.trim()) {
    return { request, armed, ran: false, steps: [], lines: ["empty request — nothing to orchestrate"] };
  }
  if (!armed) {
    lines.push(
      `auto-orchestrate DISARMED (set ${AUTO_ORCHESTRATE_FLAG}=true to run). Would run: research → scout → build-plan ` +
        `for "${request}". Propose-only; no agent invoked.`,
    );
    return { request, armed, ran: false, steps: [], lines };
  }

  const collected: StepResult[] = [];
  const research = await safeStep("research", () => steps.research(request, env, now));
  collected.push(research);
  lines.push(line(research));

  const scout = await safeStep("scout", () => steps.scout(request, research.artifact, env, now));
  collected.push(scout);
  lines.push(line(scout));

  const plan = await safeStep("build-plan", () => steps.plan(request, research.artifact, scout.artifact, env, now));
  collected.push(plan);
  lines.push(line(plan));

  const upstream = [research, scout].filter((s) => s.ok).length;
  lines.push(
    `auto-orchestrate complete — PROPOSE-ONLY: a build plan was composed from ${upstream}/2 upstream agent artifact(s). ` +
      `Nothing executed; review the plan before acting.`,
  );
  return { request, armed, ran: true, steps: collected, lines };
}
