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
import { runApprovalNotifyPass } from "../src/telegram/run-approval-notify.js";
import { runFailedJobAlertPass } from "../src/telegram/run-failed-job-alert.js";
import { runLivenessAlertPass } from "../src/telegram/run-liveness-alert.js";
import { EMPTY_ALERT_STATE, type AlertBusState } from "../src/telegram/alert-bus.js";
import type { FleetLiveness } from "../src/sentinel/sentinel-liveness.js";
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

  // Outbound Telegram ALERT BUS — pings Hart about approvals + problems (armed by ALLOW_TELEGRAM_NOTIFY
  // + TELEGRAM_BOT_TOKEN + HARTOS_TELEGRAM_NOTIFY_CHAT_ID; every pass is an honest no-op otherwise).
  // State is threaded across cycles so a still-true condition is announced once, not every poll.
  // Perception passes run on a SUB-CADENCE (not every 5s poll) to keep the daemon light.
  let notifiedIds = new Set<string>();
  let failJobState: AlertBusState = EMPTY_ALERT_STATE;
  let livenessState: AlertBusState = EMPTY_ALERT_STATE;
  let prevFleet: FleetLiveness | null = null;
  let cycle = 0;
  const ALERT_EVERY = 6; //   ~30s at the 5s poll: approvals + execution failures (light DB reads)
  const LIVENESS_EVERY = 36; // ~3min: fleet liveness (local artifact gather + pure assess)

  const runCycle = async (now: string): Promise<string[]> => {
    const lines = await runJobRunner(process.env, now, 3);
    cycle += 1;

    if (cycle % ALERT_EVERY === 0) {
      try {
        const r = await runApprovalNotifyPass(process.env, notifiedIds);
        notifiedIds = r.notified;
        if (r.sent) console.log(`[live-runner] telegram · pinged Hart about ${r.count} pending proposal(s)`);
      } catch (e) {
        console.error(`[live-runner] telegram approval notify failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
      try {
        const f = await runFailedJobAlertPass(process.env, now, failJobState);
        failJobState = f.state;
        if (f.sent) console.log(`[live-runner] telegram · alerted Hart about ${f.sent} execution failure(s)`);
      } catch (e) {
        console.error(`[live-runner] telegram failure alert failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    if (cycle % LIVENESS_EVERY === 0) {
      try {
        const l = await runLivenessAlertPass(process.env, now, prevFleet, livenessState);
        livenessState = l.state;
        prevFleet = l.fleet;
        if (l.sent) console.log(`[live-runner] telegram · alerted Hart about ${l.sent} liveness transition(s)`);
      } catch (e) {
        console.error(`[live-runner] telegram liveness alert failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }
    return lines;
  };

  void runLiveRunnerLoop(
    {
      runCycle,
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
