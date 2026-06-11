/**
 * src/jobs/live-runner.ts — the LIVE RUNNER control loop (pure, testable).
 *
 * The event-triggered half of HartOS execution: a persistent daemon that reacts to an approval
 * (GO → status `simulated_approved`) within seconds, instead of waiting for the next scheduled
 * autopilot pulse. It is a tight RECONCILE loop — it re-checks the approved-job queue on a short
 * interval and executes anything newly approved through the existing, audited job runner. A
 * reconcile loop (vs a pure push subscription) is deliberately the more reliable design: a dropped
 * socket never strands a job, and a restart catches any backlog. Latency ≈ the poll interval
 * (default 5s) — indistinguishable from instant for a human GO, with none of the websocket/RLS/
 * publication surface a Realtime push would add. (A push layer can sit on top later if desired.)
 *
 * Doctrine unchanged: it only ever runs HART-APPROVED jobs, through the same per-action gates +
 * idempotent compare-and-set advance the runner already enforces. It approves nothing itself.
 *
 * PURE here: the loop takes ALL effects (run a cycle, sleep, clock, log, stop signal) injected, so
 * it is fully unit-testable with no timers, DB, or processes. The CLI wires the real effects.
 */

export const DEFAULT_POLL_SEC = 5;
export const MIN_POLL_SEC = 2;
export const MAX_POLL_SEC = 300;

/** Resolve the reconcile interval (ms) from env, clamped to a sane band. */
export function resolvePollMs(env: Record<string, string | undefined>): number {
  const raw = Number(env["HARTOS_RUNNER_POLL_SEC"]);
  const sec = Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_POLL_SEC;
  return Math.min(MAX_POLL_SEC, Math.max(MIN_POLL_SEC, Math.floor(sec))) * 1000;
}

/**
 * Did a runner cycle actually process a job? The runner logs a terminal outcome line per job
 * (→ executed / skipped / failed); an idle cycle says "nothing to run". We log only on activity
 * so the daemon stays quiet while idle instead of spamming a line every few seconds.
 */
export function cycleDidWork(lines: string[]): boolean {
  return lines.some((l) => /→\s*(executed|skipped|failed)\b/.test(l));
}

export interface LiveRunnerControl {
  /** Run ONE reconcile cycle (the job runner over the approved queue); returns its log lines. */
  runCycle: (now: string) => Promise<string[]>;
  /** Sleep ms (injected so tests don't use real timers). */
  sleep: (ms: number) => Promise<void>;
  /** Injected clock (ISO). */
  now: () => string;
  /** Emit a line (console in prod; collected in tests). */
  log: (line: string) => void;
  /** Cooperative stop (SIGINT/SIGTERM in prod; a counter in tests). Checked before each cycle + sleep. */
  shouldStop: () => boolean;
}

export interface LiveRunnerSummary {
  cycles: number;
  activeCycles: number;
}

/**
 * The reconcile loop. Runs a cycle, logs only when it did work, sleeps the interval, repeats until
 * `shouldStop()`. A thrown cycle is logged and the loop continues (a transient DB blip must not
 * kill the daemon). Returns counts for the shutdown summary. Deterministic given its injected deps.
 */
export async function runLiveRunnerLoop(ctrl: LiveRunnerControl, pollMs: number): Promise<LiveRunnerSummary> {
  let cycles = 0;
  let activeCycles = 0;
  while (!ctrl.shouldStop()) {
    cycles += 1;
    let lines: string[] = [];
    try {
      lines = await ctrl.runCycle(ctrl.now());
    } catch (err) {
      ctrl.log(`[live-runner] cycle error (continuing): ${err instanceof Error ? err.message : String(err)}`);
    }
    if (cycleDidWork(lines)) {
      activeCycles += 1;
      for (const l of lines) ctrl.log(l);
    }
    if (ctrl.shouldStop()) break;
    await ctrl.sleep(pollMs);
  }
  return { cycles, activeCycles };
}
