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
import { runSpineExecutor } from "./run-spine-executor.js";
import { runFitnessPollPass } from "./run-fitness-poll.js";
import { runSelfModPassOnce } from "./run-self-mod-pass.js";
import { runCouncilOnce } from "./run-council-pass.js";
import { runCouncilBuildBridgeOnce } from "./run-council-build-bridge.js";
// P-B2 — ask-relay daemon sub-pass. DISARMED: a no-op unless HARTOS_ASK_RELAY=on.
import { runAskRelayOnce } from "./run-ask-relay-pass.js";
import { runP8CalibrateOnce } from "./run-p8-calibrate-pass.js";
import { runSentinelWolverineOnce } from "./run-sentinel-wolverine-pass.js";
import { runApprovalNotifyPass } from "../src/telegram/run-approval-notify.js";
import { runFailedJobAlertPass } from "../src/telegram/run-failed-job-alert.js";
import { runLivenessAlertPass } from "../src/telegram/run-liveness-alert.js";
import { EMPTY_ALERT_STATE, type AlertBusState } from "../src/telegram/alert-bus.js";
import type { FleetLiveness } from "../src/sentinel/sentinel-liveness.js";
import { writeDaemonHeartbeat } from "../src/jobs/daemon-heartbeat-store.js";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
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

  // Dead-man's-switch source: write a liveness heartbeat to Supabase that the always-on Worker cron
  // reads (an external observer is the ONLY honest way to detect this process's own death). All
  // best-effort — a DB blip never crashes the daemon. See src/jobs/daemon-heartbeat-store.ts.
  const mkDb = () => createCockpitProposalDb(process.env);
  const beat = (status: "alive" | "error" | "crashed", reason?: string) =>
    void writeDaemonHeartbeat(mkDb, status, reason).catch((e) => console.error(`[live-runner] heartbeat write failed: ${redact(String(e instanceof Error ? e.message : e))}`));

  // Resilience: a stray async error (a dropped DB socket, a fetch reject) must NOT kill the daemon.
  // Log it, mark the heartbeat errored (a courtesy — staleness is the real detector), keep looping.
  process.on("uncaughtException", (e) => { console.error(`[live-runner] uncaught (continuing): ${redact(String(e instanceof Error ? e.message : e))}`); beat("error", e instanceof Error ? e.message : String(e)); });
  process.on("unhandledRejection", (e) => { console.error(`[live-runner] unhandled rejection (continuing): ${redact(String(e))}`); beat("error", String(e)); });
  // Heartbeat: prove liveness in the log AND to the Supabase row the Worker watches (every 5 min).
  beat("alive"); // write one immediately so the row exists right after start
  const heartbeat = setInterval(() => { console.log(`[live-runner] heartbeat · alive · ${new Date().toISOString()}`); beat("alive"); }, 300_000);
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
  const FITNESS_POLL_EVERY = 60; // ~5min: poll the fitness side for pending mutations (daily cadence; gated no-op by default)
  const SELF_MOD_EVERY = 60; // ~5min
  // P7 Council: ~10min cadence. DISARMED by default (HARTOS_ALLOW_COUNCIL=true required).
  // No autonomous goal source in this slice — no-op unless a goal is provided externally.
  const COUNCIL_EVERY = 120; // ~10min
  // P7 Council→Factory bridge: ~10min cadence. DISARMED by default (HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE=true required).
  // A no-op unless the flag is set; produces propose-only factory build-plan proposals from approved council proposals.
  const COUNCIL_BUILD_BRIDGE_EVERY = 120; // ~10min
  const P8_CALIBRATE_EVERY = 720; // ~1h: P8 council-calibration learning pass (slow; learning is not time-critical)
  const SENTINEL_WOLVERINE_EVERY = 60; // ~5min: auto-engage Wolverine on a down/stale agent (advisory, gated)
  // P-B2 ask-relay: every cycle (~1.5s at the 5s base, but we run this on EVERY cycle so the
  // daemon answers pending relay rows within ~1-2 poll cycles). DISARMED: no-op unless HARTOS_ASK_RELAY=on.
  // Independent of the 5s job poll: the relay runAskRelayOnce is cheap (single DB read when no rows).
  const ASK_RELAY_EVERY = 1; // every cycle — relay rows are short-lived (~2min TTL)

  const runCycle = async (now: string): Promise<string[]> => {
    const lines = await runJobRunner(process.env, now, 3);
    cycle += 1;

    // MUTATION proposals (Wolverine fixes, ClickUp ops) — Hart's "daemon runs everything" decision:
    // a cockpit Approve on a mutation no longer dead-ends at simulated_approved. Every 3rd cycle
    // (~15s) the gated spine executor runs them; each adapter still requires its own ALLOW_EXEC_*
    // flag (disarmed ⇒ honest no_write, row stays approved + re-runnable). Error-isolated.
    if (cycle % 3 === 0) {
      try {
        const mut = await runSpineExecutor(process.env, new Date(now), 3);
        const didWork = mut.some((l) => l.includes("→") || l.includes("executed (wrote)"));
        if (didWork && !mut[0]?.startsWith("No cockpit-approved")) {
          for (const l of mut) console.log(`[live-runner] mutation · ${l}`);
        }
      } catch (e) {
        console.error(`[live-runner] mutation executor failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // FITNESS poll (P5) — every ~5min, materialise the fitness side's pending mutations into the
    // spine as pending_approval proposals. GATED: a pure no-op unless HARTOS_FITNESS_POLL=on + the
    // fitness identity is set (so it never polls a not-yet-existing RPC). Enqueues only; the approval
    // floor + ALLOW_FITNESS_ADJUST + the gated executor still decide every write. Error-isolated.
    if (cycle % FITNESS_POLL_EVERY === 0) {
      try {
        const fit = await runFitnessPollPass(process.env, new Date(now));
        const did = fit.some((l) => /ingested [1-9]/.test(l));
        if (did) for (const l of fit) console.log(`[live-runner] fitness · ${l}`);
      } catch (e) {
        console.error(`[live-runner] fitness poll failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // SELF-MOD (P6 §6) — every ~5min, run one self-mod pass. DISARMED + no-op unless armed AND a task
    // source yields a task (runSelfModPassOnce returns [] otherwise). Gated; nothing applies until §6 is
    // ratified + the flags are armed AND a proposal/deploy is gated through.
    if (cycle % SELF_MOD_EVERY === 0) {
      try {
        const sm = await runSelfModPassOnce(process.env, new Date(now));
        for (const l of sm) console.log(`[live-runner] ${l}`);
      } catch (e) {
        console.error(`[live-runner] self-mod pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // COUNCIL (P7 Plan 2) — every ~10min. DISARMED + no-op unless HARTOS_ALLOW_COUNCIL=true.
    // No autonomous goal source exists in this slice: HARTOS_COUNCIL_GOAL env var is the only way
    // to supply a goal (absent/blank → [] no-op). Do NOT invent an autonomous goal source.
    if (cycle % COUNCIL_EVERY === 0) {
      try {
        const councilGoal = (process.env["HARTOS_COUNCIL_GOAL"] ?? "").trim();
        const cou = await runCouncilOnce(process.env, councilGoal, new Date(now));
        for (const l of cou) console.log(`[live-runner] council · ${l}`);
      } catch (e) {
        console.error(`[live-runner] council pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // COUNCIL→FACTORY BRIDGE (P7) — every ~10min. DISARMED + no-op unless HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE=true.
    // Turns simulated_approved council proposals into pending_approval factory build-plan proposals.
    // propose-only: executable=false; no scaffolding or provisioning until Hart approves the factory proposal.
    if (cycle % COUNCIL_BUILD_BRIDGE_EVERY === 0) {
      try {
        const bridge = await runCouncilBuildBridgeOnce(process.env, now);
        for (const l of bridge) console.log(`[live-runner] council-bridge · ${l}`);
      } catch (e) {
        console.error(`[live-runner] council-build-bridge failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // P8 CALIBRATE (reflexive learning) — every ~1h. DISARMED: returns [] unless HARTOS_ALLOW_LEARNING=true.
    // Aggregates the council approve/reject track record and, on a well-evidenced delta, ENQUEUES one
    // recalibrate self-mod task. It applies nothing itself — the §6 gauntlet (its own arming triple)
    // independently governs whether the enqueued change ever lands. Error-isolated; never kills the daemon.
    if (cycle % P8_CALIBRATE_EVERY === 0) {
      try {
        const p8 = await runP8CalibrateOnce(process.env, new Date(now));
        for (const l of p8) console.log(`[live-runner] ${l}`);
      } catch (e) {
        console.error(`[live-runner] p8 calibrate pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // SENTINEL→WOLVERINE — every ~5min. DISARMED: [] unless HARTOS_ALLOW_SENTINEL_WOLVERINE=true.
    // When Sentinel marks an expected-live agent down/stale, auto-raise an advisory Wolverine
    // FixProposal (propose-only; idempotent upsert). Never restarts an agent. Error-isolated.
    if (cycle % SENTINEL_WOLVERINE_EVERY === 0) {
      try {
        const sw = await runSentinelWolverineOnce(process.env, now);
        for (const l of sw) console.log(`[live-runner] ${l}`);
      } catch (e) {
        console.error(`[live-runner] sentinel-wolverine pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

    // ASK-RELAY (P-B2) — every cycle (~5s). DISARMED: returns [] unless HARTOS_ASK_RELAY=on.
    // Pulls pending ask_request rows from the cockpit Supabase project, runs buildHostGateway()
    // (Claude-Max primary), and writes the answer back. Error-isolated; never kills the daemon.
    if (cycle % ASK_RELAY_EVERY === 0) {
      try {
        const relay = await runAskRelayOnce(process.env, now);
        const didWork = relay.some((l) => l.includes("→ answered") || l.includes("→ error"));
        if (didWork) for (const l of relay) console.log(`[live-runner] ask-relay · ${l}`);
      } catch (e) {
        console.error(`[live-runner] ask-relay pass failed (continuing): ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }

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
