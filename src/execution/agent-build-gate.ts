/**
 * src/execution/agent-build-gate.ts — the spec-interrogation gate before agent-building.
 *
 * HartOS must GRILL Hart for specs before it builds an agent (the Factory doctrine: never build
 * from vague intent). The new claude.execute hand could otherwise blind-scaffold an agent from a
 * one-line task. This gate stops that: if a claude.execute task looks like an agent-build and has
 * NOT been through the Factory's interrogation (no locked spec), it is REFUSED and the required
 * interrogation questions are surfaced — Hart answers them via the Factory, which then emits a
 * spec-locked build the executor will run.
 *
 * Pure (no I/O); reuses the existing Factory interrogator (src/hartos/spec-interrogator.ts).
 */

import { interrogateSpec } from "../hartos/spec-interrogator.js";

/** Does this task look like a request to BUILD/CREATE a new agent? (heuristic, intentionally broad). */
const AGENT_BUILD_RE = /\b(build|create|scaffold|spin\s*up|provision|make|generate|stand\s*up)\b[\s\S]{0,40}\bagent\b/i;
const AGENT_BUILD_RE2 = /\bagent\b[\s\S]{0,30}\b(build|create|scaffold|provision)\b/i;
/** A task the Factory already interrogated + spec-locked carries one of these markers. */
const SPEC_LOCK_MARKER = /\[spec[-_ ]?locked\]|spec[_-]?id\s*[:=]|locked agentspec/i;

export function isAgentBuildTask(task: string): boolean {
  return AGENT_BUILD_RE.test(task) || AGENT_BUILD_RE2.test(task);
}

export interface AgentBuildGate {
  allowed: boolean;
  reason: string;
  /** The required interrogation questions Hart must answer first (empty when allowed). */
  questions: string[];
}

/**
 * Decide whether a claude.execute task may build an agent. Non-builds pass. A spec-locked build
 * passes (interrogation already done). A raw agent-build is REFUSED with the Factory's required
 * questions — the grilling Hart asked for.
 */
export function gateAgentBuild(task: string): AgentBuildGate {
  const t = (task ?? "").trim();
  if (!t || !isAgentBuildTask(t)) {
    return { allowed: true, reason: "not an agent-build task", questions: [] };
  }
  if (SPEC_LOCK_MARKER.test(t)) {
    return { allowed: true, reason: "spec-locked — Factory interrogation already passed", questions: [] };
  }
  const interrogation = interrogateSpec(t);
  const required = interrogation.questions.filter((q) => q.required).map((q) => q.question);
  return {
    allowed: false,
    reason:
      "agent-build refused — HartOS interrogates the spec before building (the Factory never builds from vague intent). " +
      "Answer these via the Factory (npm run cockpit:ask / the cockpit), then resubmit a spec-locked build.",
    questions: required,
  };
}
