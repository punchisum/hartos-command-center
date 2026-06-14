import type { CouncilGoal, SpecialistFinding } from "./council-types.js";
import { buildSpecialistPrompt, parseFinding } from "./specialist-prompts.js";

/** A specialist convened by a council node. run() never throws — failure ⇒ a degraded finding. */
export interface Specialist {
  id: string;
  run(goal: CouncilGoal): Promise<SpecialistFinding>;
}

/** The injected model call (mirrors ask-llm's AskInfer seam). Returns raw model text. */
export type Infer = (prompt: { system: string; user: string }) => Promise<string>;

const TIMEOUT_MS = 60_000;
function withTimeout<T>(p: Promise<T>, ms: number, onTimeout: () => T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(onTimeout()), ms);
    p.then((v) => { clearTimeout(t); resolve(v); }).catch(() => { clearTimeout(t); resolve(onTimeout()); });
  });
}

export function makeLlmSpecialist(id: string, infer: Infer, timeoutMs = TIMEOUT_MS): Specialist {
  return {
    id,
    run: (goal) => {
      const degraded = (): SpecialistFinding => ({ specialistId: id, lens: id, summary: "(no finding — degraded)", confidence: "low", risks: [], degraded: true });
      const work = (async () => {
        try { return parseFinding(id, await infer(buildSpecialistPrompt(id, goal))); }
        catch { return degraded(); }
      })();
      return withTimeout(work, timeoutMs, degraded);
    },
  };
}

/** Wrap a deterministic brain (injected) as a specialist. */
export function makeBrainSpecialist(
  id: string, lens: string,
  brain: (goal: CouncilGoal) => Promise<{ summary: string; confidence: SpecialistFinding["confidence"]; risks: string[]; degraded?: boolean }>,
): Specialist {
  return {
    id,
    run: async (goal) => {
      try { const r = await brain(goal); return { specialistId: id, lens, summary: r.summary, confidence: r.confidence, risks: r.risks, degraded: r.degraded ?? false }; }
      catch { return { specialistId: id, lens, summary: "(brain failed)", confidence: "low", risks: [], degraded: true }; }
    },
  };
}
