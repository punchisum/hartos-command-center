/**
 * scripts/factory-birth.ts — `npm run factory:birth -- "build a <X> agent"`
 *
 * ONE command that turns an idea into the complete, honest agent-birth plan: the requirements draft
 * (with clarifying questions for anything missing), recommended skills/capabilities, the scaffold
 * outline, and the ORDERED GATED RUNWAY to a live agent (every command + the flag that arms it).
 *
 * Doctrine: this PLANS only — it is PURE (planAgentCreation), creates nothing, pushes nothing,
 * deploys nothing. Every mutating step in the runway stays individually gated + human-run. It just
 * removes the "which of a dozen scripts, in what order, with which flags?" toil so the Factory's
 * last mile is legible and one-command-startable.
 *
 *   npm run factory:birth -- "build a travel planning agent" --data="booking emails" --interfaces="web cockpit"
 */

import { pathToFileURL } from "node:url";
import { planAgentCreation, type AgentDraftAnswers } from "../src/cockpit/agent-planner/agent-planner.js";
import { birthRunway } from "../src/cockpit/agent-planner/birth-runway.js";

function parseArgs(argv: string[]): { request: string; answers: AgentDraftAnswers } {
  const flags: Record<string, string> = {};
  const rest: string[] = [];
  for (const a of argv) {
    const m = /^--([a-z]+)=(.*)$/.exec(a);
    if (m && m[1] !== undefined && m[2] !== undefined) flags[m[1]] = m[2];
    else rest.push(a);
  }
  const list = (s?: string): string[] | undefined =>
    s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
  const answers: AgentDraftAnswers = {
    ...(flags["name"] ? { name: flags["name"] } : {}),
    ...(list(flags["commands"]) ? { commands: list(flags["commands"]) } : {}),
    ...(list(flags["data"]) ? { dataSources: list(flags["data"]) } : {}),
    ...(list(flags["interfaces"]) ? { interfaces: list(flags["interfaces"]) } : {}),
  };
  return { request: rest.join(" ").trim(), answers };
}

/** Render the birth plan as printable lines. PURE (planAgentCreation is pure) — testable offline. */
export function renderBirth(request: string, answers: AgentDraftAnswers = {}): string[] {
  const plan = planAgentCreation(request, { answers });
  const L: string[] = [];
  const p = (s = ""): void => void L.push(s);

  p("HartOS Factory — agent birth plan (DRY-RUN; nothing created)");
  p(`Request: ${request}`);
  p("");
  p(`Agent: ${plan.draft.name}  ·  domain: ${plan.draft.domain}  ·  risk: ${plan.draft.riskLevel}`);
  p(`Summary: ${plan.summary}`);
  p("");
  if (plan.draft.missingFields.length) {
    p(`Needs from you (${plan.draft.missingFields.length}) — re-run with --commands= --data= --interfaces= :`);
    for (const q of plan.draft.clarifyingQuestions) p(`  ? ${q}`);
    p("");
  }
  p(`Recommended skills: ${plan.recommendedSkills.join(", ")}`);
  p(`Required capabilities: ${plan.requiredCapabilities.join(", ") || "(none)"}`);
  p(`Scaffold would create ${plan.scaffoldPlan.length} path(s) — the chassis only.`);
  if (plan.risks.length) {
    p("Risks:");
    for (const r of plan.risks) p(`  ! ${r}`);
  }
  if (plan.doNotBuild.length) {
    p("Do NOT build:");
    for (const d of plan.doNotBuild) p(`  x ${d}`);
  }
  p("");
  p("Gated runway to a LIVE agent (each step individually gated — arm the flag + run it yourself):");
  for (const s of birthRunway(plan)) {
    p(`  ${s.order}. ${s.title}${s.mutation ? "   [mutation — your approval]" : ""}`);
    p(`     $ ${s.command}`);
    p(`     gate: ${s.gate} — ${s.note}`);
  }
  p("");
  p("Doctrine: PLANNED only — nothing was created, pushed, or deployed.");
  p("propose → approve → execute → audit. Approve the spec in the cockpit; arm each gate yourself.");
  return L;
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { request, answers } = parseArgs(process.argv.slice(2));
  if (!request) {
    console.error('Usage: npm run factory:birth -- "build a <X> agent" [--data=a,b] [--commands=x,y] [--interfaces=web,telegram]');
    process.exit(1);
  }
  console.log("");
  for (const l of renderBirth(request, answers)) console.log(l);
  console.log("");
}
