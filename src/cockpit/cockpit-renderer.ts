/**
 * src/cockpit/cockpit-renderer.ts
 *
 * Renders the cockpit as a single self-contained HTML document (inline CSS + a
 * little vanilla JS — no React, no Vite, no external dependencies). The HTML is
 * an operator console, not a chatbot: card groups, statuses, action states,
 * missing sources, reports, and an "Ask HartOS" command panel.
 *
 * Every action button is rendered DISABLED in Phase 11H (the cockpit never
 * executes). Forbidden actions render as blocked; approval/manual actions render
 * as non-executable with an explicit gate label.
 */

import type {
  CockpitActionView,
  CockpitCardView,
  CockpitOrchestratorResponse,
  CockpitState,
} from "./cockpit-types.js";
import type { DomainPanel, PanelField } from "./panels/index.js";
import type { ActionProposal, ProposalQueueItem } from "./proposals/index.js";
import type { SourceDiagnosticsReport } from "./sources/index.js";

export interface RenderOptions {
  /** When true (snapshot), embed the state and show a static banner. */
  serverMode?: boolean;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function actionBadge(a: CockpitActionView): string {
  if (a.blocked) return '<span class="badge blocked">FORBIDDEN</span>';
  if (a.state === "manual_required") return '<span class="badge gated">MANUAL REQUIRED</span>';
  if (a.state === "approval_required") return '<span class="badge gated">APPROVAL REQUIRED</span>';
  if (a.state === "local_report_generation") return '<span class="badge local">LOCAL REPORT</span>';
  return '<span class="badge readonly">READ-ONLY</span>';
}

function renderAction(a: CockpitActionView): string {
  const cls = a.blocked ? "act blocked" : a.requiresApproval ? "act gated" : "act safe";
  // Disabled in Phase 11H: the cockpit never executes. Dangerous = blocked.
  const title = a.blocked
    ? "Forbidden — cannot be executed from the cockpit"
    : a.requiresApproval
      ? "Requires human/admin approval — non-executable from the cockpit"
      : "Stubbed in Phase 11H (no execution yet)";
  return `<button class="${cls}" disabled data-action="${escapeHtml(a.action)}" data-state="${escapeHtml(a.state)}" title="${escapeHtml(title)}">${escapeHtml(a.label)} ${actionBadge(a)}</button>`;
}

function renderCard(card: CockpitCardView): string {
  const actions = card.actions.map(renderAction).join("\n");
  return `
    <article class="card" id="card-${escapeHtml(card.id)}" data-status="${escapeHtml(card.status)}" data-risk="${escapeHtml(card.riskLevel)}">
      <header><h3>${escapeHtml(card.title)}</h3><code>${escapeHtml(card.id)}</code></header>
      <p class="desc">${escapeHtml(card.description)}</p>
      <ul class="meta">
        <li>status: <strong class="status-${escapeHtml(card.status)}">${escapeHtml(card.status)}</strong></li>
        <li>confidence: ${escapeHtml(card.confidence)}</li>
        <li>risk: ${escapeHtml(card.riskLevel)}</li>
        <li>source: ${escapeHtml(card.sourceType)}</li>
      </ul>
      <p class="src">${escapeHtml(card.sourcePaths.join(", ") || "(derived)")}</p>
      <div class="actions">${actions}</div>
    </article>`;
}

/** Empty-state markup, shown only when there is genuinely no response. */
export const RESPONSE_EMPTY_STATE =
  '<p class="muted">No Orchestrator response yet. Use Ask HartOS to send a request.</p>';

function list(items: readonly string[], emptyLabel: string): string {
  if (items.length === 0) return `<span class="muted">${escapeHtml(emptyLabel)}</span>`;
  return items.map((i) => `<code>${escapeHtml(i)}</code>`).join(" ");
}

/** Escape, then turn newlines into <br/> for multi-line grounded answers. */
function nl2br(value: string): string {
  return escapeHtml(value).replace(/\n/g, "<br/>");
}

function bullets(label: string, items: readonly string[] | undefined): string {
  if (!items || items.length === 0) return "";
  return `<p class="pl"><strong>${escapeHtml(label)}:</strong></p><ul class="lst">${items
    .map((i) => `<li>${escapeHtml(i)}</li>`)
    .join("")}</ul>`;
}

// ─── Phase 12 — domain panels + routed intent ───────────────────────────────

function panelStatusClass(status: string): string {
  return `pstatus-${escapeHtml(status)}`;
}

function fieldClass(f: PanelField): string {
  return f.status === "ok" ? "fok" : f.status === "no_data" ? "fnodata" : "fmiss";
}

function freshnessBadge(f: PanelField): string {
  if (f.status !== "ok" || !f.freshness) return "";
  const cls = f.freshness === "fresh" ? "fresh" : f.freshness === "stale" ? "stale" : "unk";
  return ` <span class="fr ${cls}">${escapeHtml(f.freshness)}</span>`;
}

function renderPanelField(f: PanelField): string {
  const setup = f.setupStep ? ` <em class="setup">→ ${escapeHtml(f.setupStep)}</em>` : "";
  const metaParts = [
    f.source ? `src: ${f.source}` : "",
    f.lastUpdated ? `updated: ${f.lastUpdated}` : "",
    f.confidence ? `conf: ${f.confidence}` : "",
  ].filter(Boolean);
  const meta = metaParts.length ? ` <span class="fmeta">(${escapeHtml(metaParts.join(" · "))})</span>` : "";
  return `<li class="${fieldClass(f)}"><strong>${escapeHtml(f.label)}:</strong> ${escapeHtml(f.value)}${freshnessBadge(f)}${setup}${meta}</li>`;
}

// ─── Phase 14A — action proposals (non-executable, dry-run only) ─────────────

function renderProposal(p: ActionProposal): string {
  const dry = p.dryRunResult;
  const dryHtml = dry
    ? `<ul class="lst">
        <li><strong>Would happen:</strong> ${escapeHtml(dry.wouldHappen)}</li>
        <li><strong>Data it would touch:</strong> ${escapeHtml(dry.dataWouldTouch.join("; ") || "none")}</li>
        <li><strong>Approval required:</strong> ${escapeHtml(dry.approvalRequired)}</li>
        <li><strong>Why execution is disabled:</strong> ${escapeHtml(dry.executionDisabledReason)}</li>
        <li><strong>Future setup to enable:</strong> ${escapeHtml(dry.futureSetupRequired.join("; ") || "n/a")}</li>
      </ul>`
    : "";
  return `<article class="card proposal" data-domain="${escapeHtml(p.domain)}" data-risk="${escapeHtml(p.riskLevel)}">
      <header><h3>${escapeHtml(p.title)}</h3><span class="badge blocked">NON-EXECUTABLE</span></header>
      <p class="desc">${escapeHtml(p.description)}</p>
      <ul class="meta">
        <li>domain: ${escapeHtml(p.domain)}</li>
        <li>risk: <strong>${escapeHtml(p.riskLevel)}</strong></li>
        <li>status: ${escapeHtml(p.status)}</li>
        <li>approval: ${escapeHtml(p.requiredApproval)}</li>
      </ul>
      <p class="desc"><strong>Expected effect:</strong> ${escapeHtml(p.expectedEffect)}</p>
      ${dryHtml}
      <div class="actions">
        <button class="act blocked" disabled title="Dry-run only — cannot execute">Simulate only <span class="badge blocked">DRY-RUN</span></button>
      </div>
      <p class="src">${escapeHtml(p.blockedReason)}</p>
    </article>`;
}

function renderProposalsSection(proposals: readonly ActionProposal[] | undefined): string {
  const list = proposals ?? [];
  const body = list.length === 0
    ? `<p class="muted">No proposals yet. A build/improve/ops/fitness Ask HartOS request generates non-executable, dry-run-only proposal drafts here.</p>`
    : `<div class="cards">${list.map(renderProposal).join("\n")}</div>`;
  return `<section id="action-proposals"><h2>Action Proposals</h2>
    <p class="muted">DRY-RUN ONLY — proposals are non-executable drafts. No real action runs, no writes, no provider calls. Execution fails closed.</p>
    ${body}</section>`;
}

// ─── Phase 14B — persisted proposal queue ────────────────────────────────────

function renderQueueItem(p: ProposalQueueItem, index: number): string {
  const dry = p.dryRunResult;
  const dryHtml = dry ? `<p class="src"><strong>dry-run:</strong> ${escapeHtml(dry.wouldHappen)}</p>` : "";
  return `<article class="card proposal" data-status="${escapeHtml(p.status)}" data-risk="${escapeHtml(p.riskLevel)}">
      <header><h3>#${index + 1} ${escapeHtml(p.title)}</h3><span class="badge blocked">NON-EXECUTABLE</span></header>
      <ul class="meta">
        <li>domain: ${escapeHtml(p.domain)}</li>
        <li>risk: <strong>${escapeHtml(p.riskLevel)}</strong></li>
        <li>status: <strong>${escapeHtml(p.status)}</strong></li>
        <li>approval: ${escapeHtml(p.requiredApproval)}</li>
        <li>audit: ${p.auditEvents.length} event(s)</li>
      </ul>
      <p class="desc">${escapeHtml(p.description)}</p>
      ${dryHtml}
      <div class="actions">
        <button class="act blocked" disabled title="DRY-RUN ONLY — REAL EXECUTION DISABLED">Simulate only <span class="badge blocked">DRY-RUN</span></button>
      </div>
      <p class="src"><code>${escapeHtml(p.id)}</code> — REAL EXECUTION DISABLED</p>
    </article>`;
}

function renderProposalQueueSection(queue: readonly ProposalQueueItem[] | undefined): string {
  const list = queue ?? [];
  const pending = list.filter((p) => p.status === "draft" || p.status === "pending_approval");
  const history = list.filter((p) => p.status !== "draft" && p.status !== "pending_approval");
  // Phase 14B cleanup — status counts so the queue is scannable at a glance.
  const count = (s: ProposalQueueItem["status"]) => list.filter((p) => p.status === s).length;
  const draft = count("draft");
  const counts = `Pending ${pending.length} (draft ${draft}) · Rejected ${count("rejected")} · Simulated ${count("simulated_approved")} · Expired ${count("expired")}`;
  const pendingHtml = pending.length ? `<div class="cards">${pending.map((p, i) => renderQueueItem(p, i)).join("\n")}</div>` : `<p class="muted">No pending proposals.</p>`;
  const historyHtml = history.length ? `<h3 class="qh">History</h3><div class="cards">${history.map((p, i) => renderQueueItem(p, pending.length + i)).join("\n")}</div>` : "";
  return `<section id="proposal-queue"><h2>Proposal Queue (${list.length})</h2>
    <p class="muted">${escapeHtml(counts)}</p>
    <p class="muted">Local, gitignored queue. NON-EXECUTABLE · DRY-RUN ONLY · REAL EXECUTION DISABLED. Use Ask HartOS: "Show pending proposals", "Dry run proposal &lt;n&gt;", "Reject proposal &lt;n&gt;", "Reject all draft fitness proposals", "Expire duplicate proposals", "Show proposal history".</p>
    ${pendingHtml}${historyHtml}</section>`;
}

// ─── Phase 13.5A — read-model diagnostics ────────────────────────────────────

function renderDiagnosticsSection(d: SourceDiagnosticsReport | undefined): string {
  if (!d) return "";
  const rows = d.domains
    .map((dom) => `<li><strong>${escapeHtml(dom.domain)}:</strong> <span class="pstatus-${dom.status === "live" ? "available" : "configured"}">${escapeHtml(dom.status)}</span> — ${escapeHtml(dom.note)}${dom.setupStep ? ` <em class="setup">→ ${escapeHtml(dom.setupStep)}</em>` : ""}</li>`)
    .join("\n");
  const rejected = d.rejectedSources.length ? `<p class="src" style="color:#f85149">Rejected unsafe key(s): ${escapeHtml(d.rejectedSources.join(", "))} — use a read-only anon key.</p>` : "";
  return `<section id="read-model-diagnostics"><h2>Read-model Diagnostics</h2>
    <div class="summary">
      <span>configured: ${escapeHtml(d.configuredSources.join(", ") || "none")}</span>
      <span>enabled: ${escapeHtml(d.enabledSources.join(", ") || "none")}</span>
      <span>disabled: ${escapeHtml(d.disabledSources.join(", ") || "none")}</span>
      <span>missing: ${escapeHtml(d.missingSources.join(", ") || "none")}</span>
      <span>stale: ${escapeHtml(d.staleSources.join(", ") || "none")}</span>
      <span>rejected: ${escapeHtml(d.rejectedSources.join(", ") || "none")}</span>
    </div>
    ${rejected}
    <ul class="lst">${rows}</ul></section>`;
}

function renderDomainPanel(p: DomainPanel): string {
  const fields = p.fields.map(renderPanelField).join("\n");
  return `<article class="card panel" id="panel-${escapeHtml(p.id)}" data-status="${escapeHtml(p.status)}">
      <header><h3>${escapeHtml(p.title)}</h3><code class="${panelStatusClass(p.status)}">${escapeHtml(p.status)}</code></header>
      <p class="desc">${escapeHtml(p.summary)}</p>
      <ul class="lst fields">${fields}</ul>
      ${bullets("Highlights", p.highlights)}
      ${bullets("Gaps", p.gaps.slice(0, 6))}
      ${bullets("Missing setup", p.missingSetupSteps)}
      <p class="next"><strong>Next action:</strong> ${escapeHtml(p.nextAction)}</p>
    </article>`;
}

function renderDomainPanels(state: CockpitState): string {
  const panels = state.panels ?? [];
  if (panels.length === 0) return "";
  return `<section id="domain-panels"><h2>Domain Panels</h2>
    <p class="muted">Read-only and degrade gracefully. Unavailable fields show <code>unknown</code> / <code>not configured</code> / <code>no data found</code> with the exact next setup step. No buttons execute anything.</p>
    <div class="cards">${panels.map(renderDomainPanel).join("\n")}</div></section>`;
}

/** Routed intent block (Phase 12B) — shown at the top of the response detail. */
function renderIntentBlock(r: CockpitOrchestratorResponse): string {
  if (!r.intent) return "";
  const suggested = r.intentSuggestedCommands && r.intentSuggestedCommands.length
    ? `<p class="pl"><strong>Try:</strong> ${r.intentSuggestedCommands.map((c) => `<code>${escapeHtml(c)}</code>`).join(" ")}</p>`
    : "";
  const clarify = r.intentClarifyingQuestion ? `<p class="pl"><em>${escapeHtml(r.intentClarifyingQuestion)}</em></p>` : "";
  const proposals = r.proposals && r.proposals.length
    ? `<p class="pl"><strong>Proposals (non-executable):</strong></p><ul class="lst">${r.proposals
        .map((p) => `<li>${escapeHtml(p.title)} <span class="badge blocked">${escapeHtml(p.riskLevel)} · ${escapeHtml(p.status)}</span></li>`)
        .join("")}</ul>`
    : "";
  return `<div class="intent">
      <h3>HartOS answer — <span class="badge readonly">${escapeHtml(r.intent)}</span></h3>
      <p class="ans">${nl2br(r.intentSummary ?? "")}</p>
      ${bullets("Highlights", r.intentHighlights)}
      ${bullets("Gaps", r.intentGaps)}
      ${bullets("Next steps", r.intentNextSteps)}
      ${proposals}
      ${clarify}${suggested}
    </div>`;
}

/**
 * Full structured detail for the latest Orchestrator response. This is the
 * server-side counterpart of the client-side `renderDetail` in CLIENT_JS — keep
 * the two in sync so a live update matches a fresh page load.
 */
function renderResponseDetail(r: CockpitOrchestratorResponse | null): string {
  if (!r) return RESPONSE_EMPTY_STATE;
  return `
    <div class="resp">
      ${renderIntentBlock(r)}
      <p><strong>Request:</strong> ${escapeHtml(r.request)}</p>
      <ul class="lst">
        <li>Classification: <strong>${escapeHtml(r.classification.classification)}</strong></li>
        <li>Domain: ${escapeHtml(r.classification.domain)}</li>
        <li>Risk level: ${escapeHtml(r.classification.riskLevel)}</li>
        <li>Build target: ${escapeHtml(r.classification.buildTarget)}</li>
        <li>Specialist: ${escapeHtml(r.classification.recommendedSpecialist)}</li>
        <li>Strategy verdict: ${escapeHtml(r.strategyReview ?? "n/a")}</li>
        <li>CTO summary: ${escapeHtml(r.ctoReview ?? "n/a")}</li>
        <li>Capability gaps: ${escapeHtml(r.capabilityGaps)}</li>
        <li>Build plan: ${escapeHtml(r.buildPlanSummary)}</li>
        ${r.llmSummary ? `<li>LLM summary: ${escapeHtml(r.llmSummary)} <em>(${escapeHtml(r.llmProvider ?? "deterministic")}/${escapeHtml(r.llmMode ?? "fallback")})</em></li>` : ""}
        <li>Next command: <code>${escapeHtml(r.nextRecommendedCommand)}</code></li>
        <li>Handover: ${r.handoverPath ? `<code>${escapeHtml(r.handoverPath)}</code>` : '<span class="muted">none</span>'}</li>
        <li>Report paths: ${list(r.reportPaths, "none")}</li>
        <li>Blocked actions: ${list(r.blockedActions, "none")}</li>
        <li>Approval-required actions: ${list(r.approvalRequiredActions, "none")}</li>
        <li>Thread id: <code>${escapeHtml(r.threadId)}</code></li>
        <li>Request id: <code>${escapeHtml(r.requestId)}</code></li>
        <li>Created: ${escapeHtml(r.createdAt)}</li>
      </ul>
    </div>`;
}

function renderRealAgents(state: CockpitState): string {
  const ai = state.agentIntegration;
  if (!ai) return "";
  if (!ai.configPresent) {
    return `<section id="real-agents"><h2>Real Agents</h2><p class="muted">Unconfigured — copy <code>agent-integrations.example.json</code> to <code>agent-integrations.local.json</code> to surface read-only Ops/Fitness status.</p></section>`;
  }
  const agents = ai.agents
    .map((a) => {
      const cards = a.cards
        .map((c) => `<li><strong>${escapeHtml(String(c.metrics["card"] ?? a.agentName))}</strong>: ${escapeHtml(c.summary)}</li>`)
        .join("\n");
      return `<article class="card"><header><h3>${escapeHtml(a.agentName)}</h3><code>${escapeHtml(a.agentType)}</code></header>
        <ul class="meta"><li>status: <strong class="status-${escapeHtml(a.status)}">${escapeHtml(a.status)}</strong></li></ul>
        <ul class="lst">${cards}</ul></article>`;
    })
    .join("\n");
  return `<section id="real-agents"><h2>Real Agents</h2>
    <p class="muted">Read-only. ${ai.configuredAgents} configured, ${ai.detectedAgents} detected. No Ops/Fitness internals are called.</p>
    <div class="cards">${agents || '<span class="muted">none</span>'}</div></section>`;
}

function renderRealData(state: CockpitState): string {
  const rm = state.readModels;
  if (!rm) return "";
  if (!rm.configPresent) {
    return `<section id="real-data"><h2>Real Data</h2><p class="muted">Unconfigured — copy <code>read-models.example.json</code> to <code>read-models.local.json</code>. Read models are read-only and disabled by default.</p></section>`;
  }
  const items = rm.summaries
    .map((s) => `<article class="card"><header><h3>${escapeHtml(s.id)}</h3><code>${escapeHtml(s.type)}</code></header>
      <ul class="meta"><li>status: <strong class="status-${escapeHtml(s.status)}">${escapeHtml(s.status)}</strong></li></ul>
      <ul class="lst">${s.lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("\n")}</ul></article>`)
    .join("\n");
  return `<section id="real-data"><h2>Real Data</h2>
    <p class="muted">Read-only Supabase boundary. ${rm.configuredReadModels} configured, ${rm.enabledReadModels} enabled. No mutation methods exist.</p>
    <div class="cards">${items || '<span class="muted">none</span>'}</div></section>`;
}

const STYLE = `
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;font:14px/1.5 ui-monospace,Menlo,Consolas,monospace;background:#0d1117;color:#c9d1d9}
  header.top{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:#161b22;border-bottom:1px solid #30363d}
  header.top h1{font-size:16px;margin:0}
  .pill{background:#1f6feb;color:#fff;border-radius:10px;padding:2px 8px;font-size:11px}
  .layout{display:grid;grid-template-columns:200px 1fr 360px;gap:0;height:calc(100vh - 49px)}
  nav{border-right:1px solid #30363d;padding:12px;overflow:auto}
  nav a{display:block;color:#c9d1d9;text-decoration:none;padding:6px 8px;border-radius:6px}
  nav a:hover{background:#21262d}
  main{padding:16px;overflow:auto}
  aside{border-left:1px solid #30363d;padding:16px;overflow:auto;background:#0b0f14}
  .summary{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px}
  .summary span{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:4px 8px;font-size:12px}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px}
  .card{background:#161b22;border:1px solid #30363d;border-radius:8px;padding:12px}
  .card header{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
  .card h3{font-size:14px;margin:0}
  .card code{color:#8b949e;font-size:11px}
  .desc{color:#8b949e;font-size:12px}
  ul.meta{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:8px 0;font-size:11px}
  .status-ok{color:#3fb950}.status-missing{color:#d29922}.status-error{color:#f85149}
  .actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
  button.act{font:inherit;border-radius:6px;border:1px solid #30363d;background:#21262d;color:#c9d1d9;padding:4px 8px;cursor:not-allowed;opacity:.85;font-size:11px}
  button.act.blocked{border-color:#f85149;color:#f85149}
  button.act.gated{border-color:#d29922;color:#d29922}
  .badge{font-size:9px;border-radius:8px;padding:1px 5px;margin-left:4px}
  .badge.blocked{background:#f85149;color:#000}
  .badge.gated{background:#d29922;color:#000}
  .badge.local{background:#1f6feb;color:#fff}
  .badge.readonly{background:#30363d;color:#c9d1d9}
  textarea{width:100%;min-height:80px;background:#0d1117;color:#c9d1d9;border:1px solid #30363d;border-radius:6px;padding:8px;font:inherit}
  .ask button{margin-top:8px;background:#238636;color:#fff;border:none;border-radius:6px;padding:8px 14px;cursor:pointer;font:inherit}
  h2{font-size:13px;text-transform:uppercase;letter-spacing:.05em;color:#8b949e;border-bottom:1px solid #30363d;padding-bottom:4px}
  .muted{color:#8b949e}
  code{background:#0d1117;padding:1px 4px;border-radius:4px}
  ul.lst{padding-left:18px;font-size:12px}
  .panel ul.fields{list-style:none;padding-left:0}
  .panel ul.fields li{margin:2px 0;border-left:2px solid #30363d;padding-left:8px}
  .panel li.fok{border-left-color:#3fb950}
  .panel li.fnodata{border-left-color:#d29922}
  .panel li.fmiss{border-left-color:#6e7681}
  .panel .setup{color:#58a6ff;font-style:italic}
  .panel .fmeta{color:#6e7681;font-size:10px}
  .panel .next{font-size:12px;color:#c9d1d9;margin-top:8px}
  .pstatus-available,.pstatus-detected{color:#3fb950}
  .pstatus-configured{color:#d29922}
  .pstatus-unconfigured,.pstatus-unavailable{color:#8b949e}
  .intent{border:1px solid #1f6feb;border-radius:8px;padding:10px;margin-bottom:12px;background:#0d1b2e}
  .intent h3{margin:0 0 6px;font-size:13px}
  .intent .ans{font-size:13px;color:#e6edf3}
  .pl{margin:6px 0 0;font-size:12px}
  .fr{font-size:9px;border-radius:8px;padding:1px 5px;margin-left:4px}
  .fr.fresh{background:#238636;color:#fff}
  .fr.stale{background:#d29922;color:#000}
  .fr.unk{background:#30363d;color:#c9d1d9}
  .proposal{border-color:#8957e5}
  .proposal header h3{color:#d2a8ff}
`;

// Client-side mirror of renderResponseDetail. A live Ask HartOS update must
// produce the same structured detail as a fresh page load — so the detail panel
// never gets stuck on the empty-state once a response exists.
const CLIENT_JS = `
  (function(){
    var form = document.getElementById('ask-form');
    if(!form) return;
    var detail = document.getElementById('latest-response-detail');
    var statusEl = document.getElementById('ask-status');
    function esc(v){
      return String(v == null ? '' : v)
        .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
        .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
    }
    function codeList(items, empty){
      if(!items || !items.length) return '<span class="muted">' + esc(empty) + '</span>';
      return items.map(function(i){ return '<code>' + esc(i) + '</code>'; }).join(' ');
    }
    function bull(label, items){
      if(!items || !items.length) return '';
      return '<p class="pl"><strong>' + esc(label) + ':</strong></p><ul class="lst">'
        + items.map(function(i){ return '<li>' + esc(i) + '</li>'; }).join('') + '</ul>';
    }
    function nl2br(v){ return esc(v).replace(/\\n/g, '<br/>'); }
    function renderIntent(r){
      if(!r.intent) return '';
      var sug = (r.intentSuggestedCommands && r.intentSuggestedCommands.length)
        ? '<p class="pl"><strong>Try:</strong> ' + r.intentSuggestedCommands.map(function(c){ return '<code>' + esc(c) + '</code>'; }).join(' ') + '</p>' : '';
      var clar = r.intentClarifyingQuestion ? '<p class="pl"><em>' + esc(r.intentClarifyingQuestion) + '</em></p>' : '';
      var props = (r.proposals && r.proposals.length)
        ? '<p class="pl"><strong>Proposals (non-executable):</strong></p><ul class="lst">'
          + r.proposals.map(function(p){ return '<li>' + esc(p.title) + ' <span class="badge blocked">' + esc(p.riskLevel) + ' · ' + esc(p.status) + '</span></li>'; }).join('') + '</ul>'
        : '';
      return '<div class="intent"><h3>HartOS answer — <span class="badge readonly">' + esc(r.intent) + '</span></h3>'
        + '<p class="ans">' + nl2br(r.intentSummary || '') + '</p>'
        + bull('Highlights', r.intentHighlights)
        + bull('Gaps', r.intentGaps)
        + bull('Next steps', r.intentNextSteps)
        + props + clar + sug + '</div>';
    }
    function renderDetail(r){
      if(!r) return '<p class="muted">No Orchestrator response yet. Use Ask HartOS to send a request.</p>';
      var c = r.classification || {};
      var llm = r.llmSummary ? '<li>LLM summary: ' + esc(r.llmSummary) + ' <em>(' + esc(r.llmProvider || 'deterministic') + '/' + esc(r.llmMode || 'fallback') + ')</em></li>' : '';
      return '<div class="resp">'
        + renderIntent(r)
        + '<p><strong>Request:</strong> ' + esc(r.request) + '</p>'
        + '<ul class="lst">'
        + '<li>Classification: <strong>' + esc(c.classification) + '</strong></li>'
        + '<li>Domain: ' + esc(c.domain) + '</li>'
        + '<li>Risk level: ' + esc(c.riskLevel) + '</li>'
        + '<li>Build target: ' + esc(c.buildTarget) + '</li>'
        + '<li>Specialist: ' + esc(c.recommendedSpecialist) + '</li>'
        + '<li>Strategy verdict: ' + esc(r.strategyReview == null ? 'n/a' : r.strategyReview) + '</li>'
        + '<li>CTO summary: ' + esc(r.ctoReview == null ? 'n/a' : r.ctoReview) + '</li>'
        + '<li>Capability gaps: ' + esc(r.capabilityGaps) + '</li>'
        + '<li>Build plan: ' + esc(r.buildPlanSummary) + '</li>'
        + llm
        + '<li>Next command: <code>' + esc(r.nextRecommendedCommand) + '</code></li>'
        + '<li>Handover: ' + (r.handoverPath ? '<code>' + esc(r.handoverPath) + '</code>' : '<span class="muted">none</span>') + '</li>'
        + '<li>Report paths: ' + codeList(r.reportPaths, 'none') + '</li>'
        + '<li>Blocked actions: ' + codeList(r.blockedActions, 'none') + '</li>'
        + '<li>Approval-required actions: ' + codeList(r.approvalRequiredActions, 'none') + '</li>'
        + '<li>Thread id: <code>' + esc(r.threadId) + '</code></li>'
        + '<li>Request id: <code>' + esc(r.requestId) + '</code></li>'
        + '<li>Created: ' + esc(r.createdAt) + '</li>'
        + '</ul></div>';
    }
    form.addEventListener('submit', async function(e){
      e.preventDefault();
      var req = document.getElementById('ask-input').value || '';
      statusEl.textContent = 'Routing to Orchestrator...';
      try{
        var res = await fetch('/api/orchestrator/message', {
          method:'POST', headers:{'content-type':'application/json'},
          body: JSON.stringify({ request: req })
        });
        var data = await res.json();
        if(!res.ok){ statusEl.textContent = 'Error: ' + (data && data.error ? data.error : res.status); return; }
        statusEl.textContent = 'Done. Intent: ' + (data.intent || (data.classification && data.classification.classification));
        if(detail) detail.innerHTML = renderDetail(data);
      }catch(err){ statusEl.textContent = 'Local error: ' + err; }
    });
  })();
`;

export function renderCockpitHtml(state: CockpitState, options: RenderOptions = {}): string {
  const serverMode = options.serverMode === true;
  const s = state.summary;

  const nav = state.groups
    .map((g) => `<a href="#group-${escapeHtml(g.group)}">${escapeHtml(g.title)} (${g.cards.length})</a>`)
    .join("\n");

  const groupsHtml = state.groups
    .map(
      (g) => `
      <section id="group-${escapeHtml(g.group)}">
        <h2>${escapeHtml(g.title)}</h2>
        <div class="cards">${g.cards.map(renderCard).join("\n")}</div>
      </section>`
    )
    .join("\n");

  const reportsHtml = state.reports.slice(0, 25).map((r) => `<li><code>${escapeHtml(r.relativePath)}</code></li>`).join("\n");
  const missingHtml = state.missingSources.map((m) => `<li>${escapeHtml(m)}</li>`).join("\n");
  // Forbidden + gated actions are surfaced as DISABLED buttons so they are
  // visibly blocked/non-executable (they are never rendered as card buttons).
  const forbiddenHtml = state.forbiddenActions
    .map((a) => `<button class="act blocked" disabled data-action="${escapeHtml(a)}" data-state="forbidden">${escapeHtml(a.replace(/_/g, " "))} <span class="badge blocked">FORBIDDEN</span></button>`)
    .join("\n");
  const gatedActions = [...state.approvalRequiredActions, ...state.manualRequiredActions];
  const approvalHtml = gatedActions
    .map((a) => `<button class="act gated" disabled data-action="${escapeHtml(a)}" data-state="gated">${escapeHtml(a.replace(/_/g, " "))} <span class="badge gated">NON-EXECUTABLE</span></button>`)
    .join("\n");

  const askNote = serverMode
    ? '<p class="muted">Commands HartOS Orchestrator locally. Recommendations only — no execution.</p>'
    : '<p class="muted">Static snapshot. Run <code>npm run cockpit:web</code> for a live Ask HartOS panel.</p>';

  const stateJson = JSON.stringify(state).replace(/</g, "\\u003c");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>HartOS Command Center — Local Visible Cockpit</title>
<style>${STYLE}</style>
</head>
<body>
<header class="top">
  <h1>HartOS Command Center <span class="pill">local mode</span></h1>
  <div>generated ${escapeHtml(state.generatedAt)}</div>
</header>
<div class="layout">
  <nav>
    <a href="#domain-panels"><strong>Domain Panels</strong></a>
    <a href="#read-model-diagnostics"><strong>Read-model Diagnostics</strong></a>
    <a href="#proposal-queue"><strong>Proposal Queue</strong></a>
    <a href="#action-proposals"><strong>Action Proposals</strong></a>
    <hr/>
    <strong>Card groups</strong>
    ${nav}
    <hr/>
    <a href="#real-agents">Real Agents</a>
    <a href="#real-data">Real Data</a>
    <a href="#reports">Reports (${s.reportCount})</a>
    <a href="#visibility">Visibility</a>
  </nav>
  <main>
    <div class="summary">
      <span>cards: ${s.cardCount}</span>
      <span>missing sources: ${s.missingSourceCount}</span>
      <span>read-only: ${s.readOnlyActionCount}</span>
      <span>approval: ${s.approvalRequiredActionCount}</span>
      <span>manual: ${s.manualRequiredActionCount}</span>
      <span>forbidden: ${s.forbiddenActionCount}</span>
      <span>reports: ${s.reportCount}</span>
      <span>next: <code>${escapeHtml(s.nextRecommendedCommand)}</code></span>
    </div>
    ${renderDomainPanels(state)}
    ${renderDiagnosticsSection(state.sourceDiagnostics)}
    ${renderProposalQueueSection(state.proposalQueue)}
    ${renderProposalsSection(state.latestResponse?.proposals)}
    ${groupsHtml}
    ${renderRealAgents(state)}
    ${renderRealData(state)}
    <section id="visibility">
      <h2>Action visibility</h2>
      <p>Forbidden (blocked):</p><div class="actions">${forbiddenHtml || "<span class='muted'>none</span>"}</div>
      <p>Approval / manual required (non-executable):</p><div class="actions">${approvalHtml || "<span class='muted'>none</span>"}</div>
      <p>Missing sources:</p><ul class="lst">${missingHtml || "<li>none</li>"}</ul>
    </section>
    <section id="reports">
      <h2>Latest local reports</h2>
      <ul class="lst">${reportsHtml || "<li>none yet — run a report command</li>"}</ul>
    </section>
  </main>
  <aside>
    <h2>Ask HartOS</h2>
    ${askNote}
    <form id="ask-form" class="ask">
      <textarea id="ask-input" placeholder="Command HartOS Orchestrator, e.g. Build me a tax specialist agent"></textarea>
      <button type="submit"${serverMode ? "" : " disabled"}>Send to Orchestrator</button>
    </form>
    <p id="ask-status" class="muted"></p>
    <h2>Latest response detail</h2>
    <div id="latest-response-detail">${renderResponseDetail(state.latestResponse)}</div>
  </aside>
</div>
<script>window.__COCKPIT_STATE__=${stateJson};</script>
<script>${CLIENT_JS}</script>
</body>
</html>
`;
}
