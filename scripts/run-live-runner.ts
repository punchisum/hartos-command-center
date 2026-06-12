/**
 * scripts/run-live-runner.ts — the LIVE RUNNER daemon (event-triggered execution).
 *
 * A persistent process that reacts to an approval within seconds: it reconcile-polls the
 * Hart-approved job queue every HARTOS_RUNNER_POLL_SEC (default 5s) and executes anything newly
 * approved through the existing gated runner. Pair it with the SENSE-ONLY autopilot
 * (HARTOS_AUTOPILOT_SENSE_ONLY=true) so the scheduled pulse does perception only and this daemon
 * owns execution. Only HART-APPROVED jobs run; per-action gates + the approval floor are unchanged.
 *
 * Run it (foreground): npm run live:runner    ·    stop with Ctrl-C.
 * Launch at logon for 24/7 via scripts/run-live-runner.cmd (Windows Task Scheduler, ONLOGON).
 */

import { pathToFileURL } from "node:url";
import { runLiveRunnerLoop, resolvePollMs } from "../src/jobs/live-runner.js";
import { runJobRunner } from "./hartos-runner.js";
import { redact } from "../src/llm/redaction.js";

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  let stop = false;
  const requestStop = (sig: string) => {
    if (!stop) console.log(`\n[live-runner] ${sig} — finishing the current cycle, then stopping…`);
    stop = true;
  };
  process.on("SIGINT", () => requestStop("SIGINT"));
  process.on("SIGTERM", () => requestStop("SIGTERM"));

  // Resilience: a stray async error (a dropped DB socket, a fetch reject) must NOT kill the daemon.
  // Log it and keep the reconcile loop alive; the per-cycle try/catch handles in-cycle failures.
  process.on("uncaughtException", (e) => console.error(`[live-runner] uncaught (continuing): ${redact(String(e instanceof Error ? e.message : e))}`));
  process.on("unhandledRejection", (e) => console.error(`[live-runner] unhandled rejection (continuing): ${redact(String(e))}`));
  // Heartbeat so the log proves liveness even when idle (and a supervisor/Sentinel can see it).
  const heartbeat = setInterval(() => console.log(`[live-runner] heartbeat · alive · ${new Date().toISOString()}`), 300_000);
  heartbeat.unref?.();

  const pollMs = resolvePollMs(process.env);
  console.log(
    `HartOS live runner — event-triggered execution. Reconciling the approved-job queue every ` +
      `${pollMs / 1000}s. Only Hart-approved jobs run; per-action gates hold. Ctrl-C to stop.\n`,
  );

  void runLiveRunnerLoop(
    {
      runCycle: (now) => runJobRunner(process.env, now, 3),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
      now: () => new Date().toISOString(),
      log: (l) => console.log(l),
      shouldStop: () => stop,
    },
    pollMs,
  )
    .then((s) => {
      console.log(`\n[live-runner] stopped after ${s.cycles} cycle(s); ${s.activeCycles} did work.`);
      process.exit(0);
    })
    .catch((e) => {
      console.error(`[live-runner] fatal: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
