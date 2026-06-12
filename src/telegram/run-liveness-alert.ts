/**
 * src/telegram/run-liveness-alert.ts — proactive "agent X went down" alerts.
 *
 * Turns Sentinel's passive cockpit-only liveness into a push: each (slow-cadence) pass folds the
 * registry with locally-gathered heartbeats via the PURE `assessFleetLiveness`, diffs the result
 * against the PREVIOUS cycle's fleet, and alerts ONLY on a real worsening transition
 * (up→stale, up→down, stale→down) for agents the registry expects to be running. A recovery to
 * 'up' sends one info note. 'unknown' is never alerted (no evidence ≠ down).
 *
 * Edge-triggered by design: the FIRST pass seeds the baseline silently (no flood of pre-existing
 * stale agents on daemon start); only subsequent degradations alert. Threads prevFleet + the bus
 * dedup state. NODE host only (gathers local artifact evidence). Gated via the shared bus gate.
 */

import { resolveMetaAgentRegistry } from "../agents/meta-agent-registry.js";
import { assessFleetLiveness, type FleetLiveness, type LivenessState, type LivenessVerdict, type AgentHeartbeat } from "../sentinel/sentinel-liveness.js";
import { gatherLocalHeartbeats } from "../sentinel/sentinel-host.js";
import { TelegramHttpSender } from "./sender.js";
import { getEnv } from "../runtime/env.js";
import type { TelegramSender } from "../shared/types.js";
import { telegramNotifyConfig, sendAlerts, type Alert, type AlertBusState } from "./alert-bus.js";

const RANK: Record<LivenessState, number> = { up: 0, unknown: 1, stale: 2, down: 3 };

/** Alert only on a registry-expected agent that is actually down/stale (exclude expected-dormant). */
function isAlertable(v: LivenessVerdict): boolean {
  return (v.state === "down" || v.state === "stale") && (v.catalogStatus === "live" || v.catalogStatus === "partial");
}

/**
 * Pure diff: alerts for agents that WORSENED since `prev` (+ a recovery info note). `prev=null`
 * (first pass) returns [] — the baseline is established silently to avoid a startup flood.
 */
export function livenessTransitionAlerts(prev: FleetLiveness | null, cur: FleetLiveness): Alert[] {
  if (!prev) return [];
  const before = new Map(prev.verdicts.map((v) => [v.agentId, v.state] as const));
  const alerts: Alert[] = [];
  for (const v of cur.verdicts) {
    const prevState = before.get(v.agentId) ?? "up";
    if (RANK[v.state] > RANK[prevState] && isAlertable(v)) {
      alerts.push({
        key: `liveness:${v.agentId}:${v.state}`,
        severity: v.state === "down" ? "high" : "medium",
        title: `${v.displayName} is ${v.state}`,
        body: `${v.displayName} (${v.state}, ${v.ageHours ?? "?"}h since last evidence).\n${v.reason}`,
        source: "Sentinel",
      });
    } else if ((prevState === "down" || prevState === "stale") && v.state === "up") {
      alerts.push({
        key: `liveness:${v.agentId}:recovered`,
        severity: "info",
        title: `${v.displayName} recovered`,
        body: `${v.displayName} is back to up (fresh evidence).`,
        source: "Sentinel",
      });
    }
  }
  return alerts;
}

export interface LivenessAlertResult {
  configured: boolean;
  reason?: string;
  sent: number;
  state: AlertBusState;
  /** The fleet this pass observed — thread it back as the next call's `prevFleet`. */
  fleet: FleetLiveness | null;
}

/**
 * Run one liveness alert pass. `prevFleet` is the previous cycle's fleet (null on first call →
 * silent baseline). Threads the bus dedup `state`. Honest-skip when disarmed. Heartbeats + sender
 * are injectable for tests.
 */
export async function runLivenessAlertPass(
  env: Record<string, string | undefined>,
  now: string,
  prevFleet: FleetLiveness | null,
  state: AlertBusState,
  deps: { heartbeats?: AgentHeartbeat[]; sender?: TelegramSender } = {},
): Promise<LivenessAlertResult> {
  const cfg = telegramNotifyConfig(env, true);
  if (!cfg.ok) return { configured: false, reason: cfg.reason, sent: 0, state, fleet: prevFleet };

  const registry = resolveMetaAgentRegistry({ now });
  const heartbeats = deps.heartbeats ?? gatherLocalHeartbeats(env);
  const fleet = assessFleetLiveness(registry, heartbeats, now);
  const alerts = livenessTransitionAlerts(prevFleet, fleet);
  const sender = deps.sender ?? new TelegramHttpSender(getEnv(env));
  const out = await sendAlerts({ sender, chatId: cfg.chatId!, alerts, state, nowMs: Date.parse(now) });
  return { configured: true, sent: out.sent, state: out.nextState, fleet };
}
