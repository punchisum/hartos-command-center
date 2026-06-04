/**
 * scripts/cockpit-ask.ts
 *
 * cockpit:ask — run one local Orchestrator request through the cockpit bridge
 * and persist the thread + report. Local, deterministic, no mutation, no
 * network. The cockpit recommends; it never executes.
 *
 * Usage:
 *   npm run cockpit:ask -- --request="Build me a tax specialist agent"
 */

import { askOrchestrator, makeMessageInput, CockpitRequestError } from "../src/cockpit/cockpit.js";

function parseArg(argv: string[], name: string): string | null {
  const arg = argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.slice(`--${name}=`.length).trim();
}

const argv = process.argv.slice(2);
const request = parseArg(argv, "request");
const threadId = parseArg(argv, "thread") ?? undefined;

if (!request) {
  console.error('Usage: npm run cockpit:ask -- --request="<your request>"');
  process.exit(1);
}

const cwd = process.cwd();

try {
  const response = await askOrchestrator(makeMessageInput(request, threadId), { cwd });
  console.log("\nHartOS Cockpit — Ask HartOS: __AGENT_NAME__");
  console.log(`Thread: ${response.threadId}`);
  console.log(`Request: ${response.request}`);
  // Phase 12B — routed intent + grounded answer first (this is the useful bit).
  if (response.intent) {
    console.log(`\nHartOS answer [${response.intent}]:`);
    console.log(response.intentSummary ?? "");
    if (response.intentHighlights?.length) console.log(`Highlights: ${response.intentHighlights.join(" | ")}`);
    if (response.intentGaps?.length) console.log(`Gaps: ${response.intentGaps.slice(0, 5).join(" | ")}`);
    if (response.intentNextSteps?.length) console.log(`Next steps: ${response.intentNextSteps.join(" | ")}`);
    if (response.intentClarifyingQuestion) console.log(`Clarify: ${response.intentClarifyingQuestion}`);
    if (response.intentSuggestedCommands?.length) console.log(`Try: ${response.intentSuggestedCommands.join(" | ")}`);
    console.log("");
  }
  // Phase 14A — non-executable action proposal drafts (dry-run only).
  if (response.proposals?.length) {
    console.log("Action proposals (NON-EXECUTABLE / DRY-RUN ONLY):");
    for (const p of response.proposals) {
      console.log(`  • [${p.domain}/${p.riskLevel}] ${p.title} — status=${p.status}, approval=${p.requiredApproval}`);
      if (p.dryRunResult) console.log(`    dry-run: ${p.dryRunResult.wouldHappen} (${p.dryRunResult.executionDisabledReason})`);
    }
    console.log("");
  }
  console.log(`Classification: ${response.classification.classification} (domain: ${response.classification.domain}, risk: ${response.classification.riskLevel})`);
  console.log(`Strategy: ${response.strategyReview ?? "n/a"}`);
  console.log(`CTO: ${response.ctoReview ?? "n/a"}`);
  console.log(`Capability gaps: ${response.capabilityGaps}`);
  console.log(`Build plan: ${response.buildPlanSummary}`);
  console.log(`Next recommended command: ${response.nextRecommendedCommand}`);
  console.log(`Reports: ${response.reportPaths.join(", ") || "(none)"}`);
  console.log(`Blocked actions: ${response.blockedActions.join(", ") || "none"}`);
  // Phase 14B — local proposal queue snapshot (non-executable). Kept last and
  // compact so it never competes with the operator answer above.
  if (response.proposalQueue?.length) {
    const q = response.proposalQueue;
    const c = (s: string) => q.filter((p) => p.status === s).length;
    const draft = c("draft");
    const pending = draft + c("pending_approval");
    console.log(
      `\nProposal queue (${q.length}, NON-EXECUTABLE): pending ${pending} (draft ${draft}), rejected ${c("rejected")}, simulated ${c("simulated_approved")}, expired ${c("expired")}. (Show pending proposals for detail.)`
    );
  }
  console.log("");
} catch (err) {
  if (err instanceof CockpitRequestError) {
    console.error(`Rejected: ${err.message}`);
    process.exit(1);
  }
  throw err;
}
