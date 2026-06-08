/**
 * src/runtime/cloudflare-cockpit-page.ts
 *
 * Phase 16 / Blueprint v2 Phase C — the hosted Command Center cockpit HTML, in
 * the "Mission Control" (Style 5) language: a sidebar shell, a computed system
 * verdict, a fleet of expandable agent cards, ranked attention, and the real
 * proposal / trust / freshness panels.
 *
 * Four variants, all read-only and secret-free:
 *   - renderHostedCockpitPage(state, opts)  → the landing cockpit (authed)
 *   - renderAgentDetailPage(detail, domain) → the full per-agent dashboard (Phase C)
 *   - renderLoginPage(opts)                 → the access-token login screen
 *   - renderLockedPage()                    → fail-closed page (auth misconfigured)
 *
 * Invariants (unchanged): server-rendered; no secrets ever embedded; every
 * dynamic string HTML-escaped; honest about staleness (nothing fabricated); the
 * verdict is computed from facts — the deterministic read-only path NEVER fakes
 * an LLM "voice". The page works without JavaScript: all data is server-rendered
 * and every agent card is a real link to its full dashboard; the Ask box is a
 * progressive enhancement that POSTs to /api/ask.
 */

import type { CockpitState } from "../cockpit/cockpit-types.js";
import {
  routeHosted,
  freshnessView,
  proposalsView,
  fleetView,
  readModelStatusView,
  type ReadModelStatusView,
  type ProposalsView,
  type FleetView,
} from "./cloudflare-cockpit-views.js";
import type { FreshnessReport } from "../cockpit/freshness-surface.js";
import { ACTION_EXECUTION } from "./cloudflare-security.js";
import type { AgentDetail } from "../read-models/agent-detail.js";
import type { GenericAgentDetail, DetailSection } from "../read-models/agent-detail-registry.js";
import type { CockpitThreadSummary } from "../cockpit/threads/cockpit-thread-spine.js";

export interface HostedPageOptions {
  runtimeMode?: string;
  generatedAt?: string | null;
  /** ISO now used for freshness; defaults to the snapshot generatedAt. */
  now?: string;
  /** Phase D — recent thread summaries from the spine, for the activity panel. */
  threads?: CockpitThreadSummary[];
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function escMultiline(s: string): string {
  return esc(s).replace(/\n/g, "<br>");
}

const STYLE = `
*{box-sizing:border-box}
:root{
  --bg:#f3f6fa;--panel:#fff;--line:#e6eaf1;--line2:#eef2f7;
  --txt:#1b2532;--dim:#5f6e80;--faint:#9aa6b6;
  --green:#15a06a;--amber:#df8a0b;--red:#e0455a;--idle:#b3bdca;
  --sg:#e7f6ef;--sa:#fcf3e2;--sb:#eef0fe;--sr:#fdecef;
  --primary:#6b4ef0;--primaryH:#5b3fe0;--accent:#2f6df6;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
}
body{margin:0;background:var(--bg);color:var(--txt);font-family:var(--sans);font-size:13.5px;line-height:1.5}
a{color:var(--accent);text-decoration:none}
code{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;background:var(--line2);border-radius:5px;padding:1px 5px}
.app{display:grid;grid-template-columns:208px 1fr;min-height:100vh}
.side{background:var(--panel);border-right:1px solid var(--line);padding:16px 12px;display:flex;flex-direction:column;gap:3px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;padding:6px 8px 14px}
.brand .mk{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,var(--primary),#9a7bff);display:grid;place-items:center;color:#fff;font-size:13px}
.nav{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:var(--dim);font-weight:600}
.nav:hover{background:var(--bg)}
.nav.active{background:var(--sb);color:var(--primary)}
.nav .ic{width:16px;text-align:center;opacity:.85}
.ro{margin-top:10px;font-size:10px;font-weight:800;letter-spacing:.5px;text-transform:uppercase;color:var(--green);background:var(--sg);border-radius:6px;padding:5px 8px;text-align:center}
.who{margin-top:auto;display:flex;align-items:center;gap:9px;padding:8px;color:var(--dim)}
.who .av{width:28px;height:28px;border-radius:50%;background:#dfe5ee;display:grid;place-items:center;font-weight:700;color:#56697e}
.main{padding:22px 26px;max-width:1180px}
.head{display:flex;align-items:flex-start;gap:14px;margin-bottom:14px}
.h1{font-size:21px;font-weight:800;letter-spacing:-.3px}
.h1 a{color:var(--txt)}
.sub{color:var(--faint);font-size:12.5px;margin-top:2px}
.grow{flex:1}
.statwrap{text-align:right}
.statlbl{font-size:10px;letter-spacing:1px;color:var(--faint);font-weight:700}
.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;font-weight:800;font-size:12px;margin-top:5px}
.pill.g{background:var(--sg);color:var(--green)}.pill.a{background:var(--sa);color:var(--amber)}.pill.r{background:var(--sr);color:var(--red)}.pill.i{background:#eef1f5;color:var(--faint)}
.badge2{display:inline-flex;align-items:center;gap:6px;padding:4px 9px;border-radius:8px;font-size:11px;font-weight:700;background:#eef1f5;color:var(--dim);margin-top:6px}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block;flex:0 0 auto}
.g{background:var(--green)}.a{background:var(--amber)}.r{background:var(--red)}.i{background:var(--idle)}
.ask{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:9px 12px;margin-bottom:14px;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.ask input{flex:1;border:none;outline:none;background:transparent;font:inherit;color:var(--txt)}
.ask .send{width:30px;height:30px;border:none;border-radius:8px;background:var(--primary);color:#fff;cursor:pointer;font-size:14px}
.ask .send:hover{background:var(--primaryH)}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 14px}
.chip{font-size:11px;border:1px solid var(--line);border-radius:7px;padding:4px 9px;color:var(--dim);background:var(--panel);cursor:pointer}
.chip:hover{border-color:var(--primary);color:var(--primary)}
pre.answer{white-space:pre-wrap;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:12px;margin:0 0 14px;font:12.5px/1.5 var(--sans)}
h2{font-size:11px;letter-spacing:1.2px;color:var(--faint);text-transform:uppercase;margin:20px 2px 10px;font-weight:800}
.attn{border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.attn .row{display:flex;align-items:center;gap:13px;padding:12px 16px;border-top:1px solid var(--line2)}
.attn .row:first-child{border-top:none}
.rk{width:22px;height:22px;border-radius:50%;background:var(--sa);color:var(--amber);display:grid;place-items:center;font-weight:800;font-size:12px;flex:0 0 auto}
.rk.ok{background:var(--sg);color:var(--green)}
.rk.now{background:var(--sb);color:var(--primary)}
.atext{flex:1}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.card{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:15px;display:flex;flex-direction:column;gap:9px;box-shadow:0 1px 2px rgba(20,40,70,.04);color:var(--txt)}
.card:hover{border-color:#cdd5e6;box-shadow:0 6px 18px rgba(20,40,70,.08)}
.ctop{display:flex;align-items:center;gap:8px}
.ico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:14px;background:var(--sb)}
.cname{font-weight:800}
.vpill{margin-left:auto;font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px;background:#eef1f5;color:var(--faint)}
.vpill.g{background:var(--sg);color:var(--green)}.vpill.a{background:var(--sa);color:var(--amber)}.vpill.r{background:var(--sr);color:var(--red)}
.cstat{font-size:11px;color:var(--faint);font-weight:600}
.facts{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--dim);font-size:12.5px}
.facts b{color:var(--txt);font-weight:700}
.sum{color:#3c4a59;border-top:1px solid var(--line2);padding-top:9px;font-size:12.5px;line-height:1.45}
.meta{display:flex;align-items:center;gap:8px;margin-top:auto}
.conf{font-size:10px;padding:3px 8px;border-radius:6px;font-weight:800;background:#eef1f5;color:var(--faint)}
.conf.high{background:var(--sg);color:var(--green)}.conf.low{background:var(--sa);color:var(--amber)}
.expandhint{margin-left:auto;font-size:11.5px;color:var(--primary);font-weight:700}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:14px}
.box{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:15px 17px;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.blbl{color:var(--faint);font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px}
.li{display:flex;align-items:center;gap:9px;padding:6px 0;color:var(--dim);font-size:12.5px}
.li b{color:var(--txt)}
.tag{margin-left:auto;font-size:10px;font-weight:800;border-radius:6px;padding:2px 8px;background:#eef2f7;color:var(--faint)}
.tag.app{background:var(--sa);color:var(--amber)}.tag.loc{background:var(--sb);color:var(--primary)}.tag.ok{background:var(--sg);color:var(--green)}
.muted{color:var(--faint);font-size:12px}
.cap{color:var(--faint);font-size:11px;margin:18px 2px 0}
footer{color:var(--faint);font-size:11.5px;margin-top:18px;padding-top:12px;border-top:1px solid var(--line2)}
.verdict{display:inline-block;font-weight:800;padding:3px 10px;border-radius:8px;font-size:12px;background:#eef1f5;color:var(--faint)}
.verdict.g,.verdict.green{background:var(--sg);color:var(--green)}
.verdict.a,.verdict.amber{background:var(--sa);color:var(--amber)}
.verdict.r,.verdict.red{background:var(--sr);color:var(--red)}
.kv{margin:6px 0}.kv b{color:var(--txt)}
.why{border-radius:11px;padding:12px 14px;font-size:12.5px;line-height:1.5;margin:10px 0;background:#eef1f5}
.why.g{background:var(--sg)}.why.a{background:var(--sa)}.why.r{background:var(--sr)}
.why .wt{font-weight:800;font-size:11px;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}
table{width:100%;border-collapse:collapse;font-size:12.5px;margin-top:4px}
th{text-align:left;padding:6px 10px;border-bottom:1px solid var(--line);color:var(--faint);font-size:11px;font-weight:700}
td{padding:6px 10px;border-bottom:1px solid var(--line2)}
.detail{max-width:920px;margin:0 auto}
.detail section{margin-bottom:14px}
.login-card{max-width:420px;margin:9vh auto;background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:24px;box-shadow:0 4px 16px rgba(20,40,70,.06)}
.login-card h1{font-size:20px;margin:0 0 4px}
.login-card input{width:100%;padding:10px;border-radius:9px;border:1px solid var(--line);background:#fff;color:var(--txt);font:inherit;margin-top:10px}
.btn{font:inherit;font-weight:700;border:1px solid var(--primary);background:var(--primary);color:#fff;border-radius:9px;padding:10px 16px;cursor:pointer}
.btn:hover{background:var(--primaryH)}
.err{color:var(--red);font-size:13px;margin-top:8px;min-height:18px}
button[disabled]{opacity:.5;cursor:not-allowed}
.ask kbd{margin-left:auto}
.expandhint,.card{cursor:pointer}
/* detail drawer (quick-peek) */
.overlay{position:fixed;inset:0;background:rgba(20,30,45,.34);opacity:0;pointer-events:none;transition:opacity .2s;z-index:40}
.overlay.show{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:460px;max-width:92vw;background:var(--panel);border-left:1px solid var(--line);box-shadow:-12px 0 40px rgba(20,40,70,.16);transform:translateX(100%);transition:transform .26s cubic-bezier(.4,0,.2,1);z-index:50;overflow-y:auto}
.drawer.show{transform:translateX(0)}
.dwrap{padding:20px 22px 40px}
.dhead{display:flex;align-items:center;gap:11px;margin-bottom:6px}
.dname{font-size:18px;font-weight:800}
.x{margin-left:auto;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;color:var(--dim);font-size:15px}
.dstatus{color:var(--faint);font-size:12px;margin-bottom:12px}
.dseclbl{font-size:10.5px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--faint);margin:14px 0 6px}
/* command palette */
.kbar{position:fixed;top:14vh;left:50%;transform:translateX(-50%) scale(.98);width:min(620px,92vw);opacity:0;pointer-events:none;transition:opacity .15s,transform .15s;z-index:60}
.kbar.show{opacity:1;pointer-events:auto;transform:translateX(-50%) scale(1)}
.kbox{background:var(--panel);border:1px solid var(--line);border-radius:13px;box-shadow:0 18px 50px rgba(20,40,70,.22);padding:14px 16px}
.kbox input{width:100%;border:none;outline:none;background:transparent;font:16px var(--sans);color:var(--txt)}
kbd{border:1px solid var(--line);border-radius:5px;padding:1px 6px;font:11px var(--sans);color:var(--faint);background:var(--bg)}
@media(max-width:980px){.app{grid-template-columns:1fr}.side{flex-direction:row;flex-wrap:wrap;border-right:none;border-bottom:1px solid var(--line)}.who{display:none}.grid4{grid-template-columns:repeat(2,1fr)}.grid3{grid-template-columns:1fr}}
`;

// ─── Shared shell + small helpers ─────────────────────────────────────────────

function shell(title: string, bodyHtml: string): string {
  return (
    "<!doctype html>" +
    `<html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">` +
    `<meta name="robots" content="noindex, nofollow">` +
    `<title>${esc(title)}</title><style>${STYLE}</style></head>` +
    `<body>${bodyHtml}</body></html>`
  );
}

type Tone = "g" | "a" | "r" | "i";

/**
 * Map a verdict word to a traffic-light tone, honestly: when the agent can't be
 * spoken to (unknown confidence / dead-or-unknown freshness) we fall to idle
 * rather than implying green — except an outright red/error verdict still shows
 * red. Covers both vocabularies (recovery green/amber/red and ops
 * clear/waiting/stale/urgent + freshness words).
 */
function tone(verdict: string, confidence: string, freshness: string): Tone {
  const lv = (verdict || "").toLowerCase();
  const hit = (arr: string[]): boolean => arr.some((x) => lv.includes(x));
  if (hit(["red", "urgent", "error", "fail", "missing"])) return "r";
  const speakable = confidence !== "unknown" && freshness !== "dead" && freshness !== "unknown";
  if (!speakable) return "i";
  if (hit(["green", "clear", "ok", "good", "fresh", "live", "healthy"])) return "g";
  if (hit(["amber", "warn", "waiting", "stale", "degraded", "partial", "blocked"])) return "a";
  return "i";
}

const AGENT_ICON: Record<string, string> = { fitness: "🏃", ops: "📋", factory: "🏭", research: "🔬" };
function agentIcon(type: string): string {
  return AGENT_ICON[type] ?? "🤖";
}
function titleCase(s: string): string {
  return s ? `${s[0]!.toUpperCase()}${s.slice(1)}` : s;
}
function prettyKey(k: string): string {
  return k.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
}

function listHtml(items: string[], ordered = false): string {
  if (items.length === 0) return `<p class="muted">None.</p>`;
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((i) => `<li>${escMultiline(i)}</li>`).join("")}</${tag}>`;
}

function box(label: string, inner: string, id?: string): string {
  return `<div class="box"${id ? ` id="${id}"` : ""}><div class="blbl">${esc(label)}</div>${inner}</div>`;
}

// ─── Sidebar (chrome; every link has a real destination) ──────────────────────

function sidebar(active: string): string {
  const items: Array<[string, string, string, string]> = [
    ["/", "⌂", "Home", "home"],
    ["#fleet", "▦", "Agents", "fleet"],
    ["#proposals", "≣", "Proposals", "proposals"],
    ["#health", "♥", "System Health", "health"],
    ["/control", "⟲", "Control Surface", "control"],
  ];
  const nav = items
    .map(([href, ic, label, key]) => `<a class="nav${key === active ? " active" : ""}" href="${href}"><span class="ic">${ic}</span> ${label}</a>`)
    .join("");
  return (
    `<aside class="side"><div class="brand"><span class="mk">◆</span> HartOS</div>` +
    nav +
    `<div class="ro">read-only</div>` +
    `<div class="who"><span class="av">H</span><div><div style="font-weight:700;color:var(--txt)">Hart</div><div style="font-size:11px">Operator</div></div></div>` +
    `</aside>`
  );
}

// ─── Landing panels ───────────────────────────────────────────────────────────

function fleetCard(agent: FleetView["agents"][number]): string {
  const s = agent.signal;
  const t = tone(s.verdict, s.confidence, s.freshness);
  const metrics = s.facts
    .filter((f) => f.key !== "read_status" && f.key !== "degraded_source" && f.value !== null && f.value !== "")
    .slice(0, 3);
  const factsHtml = metrics.length
    ? metrics.map((f) => `<span><b>${esc(String(f.value))}</b> ${esc(prettyKey(f.key))}</span>`).join("")
    : `<span class="muted">no metrics resolved</span>`;
  const confClass = s.confidence === "high" ? "high" : "low";
  return (
    `<a class="card" href="/agent/${esc(agent.type)}/ui" data-agent="${esc(agent.type)}">` +
    `<div class="ctop"><span class="ico">${agentIcon(agent.type)}</span><span class="cname">${esc(titleCase(agent.type))}</span>` +
    `<span class="vpill ${t}">${esc(String(s.verdict).toUpperCase())}</span></div>` +
    `<div class="cstat">${esc(s.freshness)}${s.approvalNeeded ? " · approval-gated" : ""}</div>` +
    `<div class="facts">${factsHtml}</div>` +
    `<div class="sum">${esc(s.reason)}</div>` +
    `<div class="meta"><span class="conf ${confClass}">${esc(s.confidence.toUpperCase())} · ${esc(s.freshness)}</span><span class="expandhint">expand ↗</span></div>` +
    `</a>`
  );
}

function trustBox(rms: ReadModelStatusView, fr: FreshnessReport | null): string {
  if (!rms.available) return box("Can I trust the system?", `<div class="muted">${esc(rms.note)}</div>`, "health");
  const sourceTone = (status: string, freshness: string): Tone => {
    if (freshness === "stale") return "a";
    if (status === "ok") return freshness === "dead" || freshness === "unknown" ? "a" : "g";
    if (status === "degraded") return "a";
    return "i";
  };
  const rows = rms.domains
    .map((d) => `<div class="li"><span class="dot ${sourceTone(d.status, d.freshness)}"></span>${esc(titleCase(d.domain))}<b style="margin-left:auto">${esc(d.freshness || d.status)}</b></div>`)
    .join("");
  const clickup = fr
    ? `<div class="li"><span class="dot ${fr.clickup.stale ? "a" : "g"}"></span>ClickUp sync<b style="margin-left:auto">${fr.clickup.stale ? "stale" : "current"}</b></div>`
    : "";
  const inner = rows || clickup ? rows + clickup : `<div class="muted">No sources resolved.</div>`;
  return box("Can I trust the system?", inner, "health");
}

function proposalBox(props: ProposalsView): string {
  if (!props.available || props.total === 0) {
    const note = props.available ? "No proposals in the queue." : props.note;
    return box("Proposal queue", `<div class="muted">${esc(note)}</div>`, "proposals");
  }
  const head = `<div class="li"><b>${props.total}</b>&nbsp;total${props.pending ? ` · ${props.pending} pending` : ""}</div>`;
  const rows = props.proposals
    .slice(0, 6)
    .map((p) => {
      const pending = p.status === "pending_approval" || p.status === "draft";
      const tg = pending ? "app" : "ok";
      const label = p.status === "pending_approval" ? "needs approval" : p.status;
      return `<div class="li">${esc(p.title)} <span class="tag ${tg}">${esc(label)}</span></div>`;
    })
    .join("");
  return box("Proposal queue", head + rows, "proposals");
}

function freshBox(fr: FreshnessReport | null): string {
  if (!fr) return box("Data freshness", `<div class="muted">Freshness unavailable (no live read-model data resolved).</div>`);
  const v = tone(fr.verdict, "high", "live");
  const domains = fr.domains
    .map((d) => {
      const dt: Tone = d.state === "fresh" ? "g" : d.state === "unavailable" ? "i" : "a";
      return `<div class="li"><span class="dot ${dt}"></span>${esc(titleCase(d.domain))}<b style="margin-left:auto">${esc(d.state)}</b></div>`;
    })
    .join("");
  return box(
    "Data freshness",
    `<div class="kv"><span class="verdict ${v}">${esc(fr.verdict.toUpperCase())}</span> ${esc(fr.verdictReason)}</div>` +
      domains +
      `<div class="muted" style="margin-top:8px">Safe next step: ${esc(fr.safeNextStep)}</div>`,
  );
}

/** Recent-activity panel — the Phase D thread spine surfaced (server-rendered). */
function activityBox(threads: CockpitThreadSummary[]): string {
  if (!threads.length) return box("Recent activity", `<div class="muted">No recent threads yet. Ask HartOS to start one.</div>`, "activity");
  const rows = threads
    .slice(0, 6)
    .map((t) => `<div class="li"><span>${esc(t.latestRequest || t.threadId)}</span><span class="tag">${esc(t.latestIntent || "—")}</span></div>`)
    .join("");
  return box("Recent activity", rows, "activity");
}

/** The authed landing cockpit. Grounded, read-only, server-rendered. */
export function renderHostedCockpitPage(state: CockpitState | undefined, opts: HostedPageOptions = {}): string {
  const now = opts.now ?? opts.generatedAt ?? state?.generatedAt ?? "";
  const brief = routeHosted(state, "Daily command brief");
  const fr = freshnessView(state, now);
  const props = proposalsView(state);
  const fleet = fleetView(state, now);
  const rms = readModelStatusView(state);
  const threads = opts.threads ?? [];

  const overall = (brief.highlights[0] ?? "Overall: AMBER.").replace(/^Overall:\s*/i, "").replace(/\.$/, "");
  const mainAction = (brief.highlights.find((h) => h.startsWith("Main action:")) ?? "Main action: review the cockpit.").replace(/^Main action:\s*/i, "");
  const attention = brief.highlights.filter((h) => !h.startsWith("Overall:") && !h.startsWith("Main action:"));
  const sysTone = tone(overall, "high", "live");

  const header =
    `<div class="head">` +
    `<div><div class="h1">Command Center</div><div class="sub">Mission Control · fleet overview</div></div>` +
    `<div class="grow"></div>` +
    `<div class="statwrap"><div class="statlbl">SYSTEM STATUS</div>` +
    `<span class="pill ${sysTone}"><span class="dot ${sysTone}"></span>${esc(overall.toUpperCase())}</span>` +
    `<div class="sub">${now ? `as of ${esc(now)}` : "no snapshot time"}</div>` +
    `<div class="badge2">action execution: ${esc(ACTION_EXECUTION)}</div></div>` +
    `</div>`;

  const askBar =
    `<form class="ask" id="ask-form" action="/api/ask" method="post">` +
    `<input id="q" type="text" placeholder="Ask HartOS anything…" autocomplete="off" aria-label="Ask HartOS">` +
    `<kbd>⌘K</kbd>` +
    `<button class="send" id="ask" type="submit" title="Ask HartOS">&#10148;</button></form>` +
    `<div class="chips">` +
    ["What needs my attention today?", "Is my data fresh?", "Anything urgent in ops?", "Show pending proposals"]
      .map((c) => `<span class="chip" data-q="${esc(c)}">${esc(c)}</span>`)
      .join("") +
    `</div>` +
    `<pre class="answer" id="out" style="display:none"></pre>`;

  const attentionRows =
    `<div class="row"><span class="rk now">▸</span><span class="atext"><b>${escMultiline(mainAction)}</b></span></div>` +
    attention.map((t, i) => `<div class="row"><span class="rk">${i + 1}</span><span class="atext">${escMultiline(t)}</span></div>`).join("") +
    (sysTone !== "r"
      ? `<div class="row"><span class="rk ok">✓</span><span class="atext" style="color:var(--green);font-weight:700">No red system-health issues</span></div>`
      : "");

  const fleetSection = fleet.agents.length
    ? `<div class="grid4">${fleet.agents.map(fleetCard).join("")}</div>`
    : `<div class="box"><div class="muted">${esc(fleet.note)}</div></div>`;

  const body =
    `<div class="app">${sidebar("home")}<main class="main">` +
    header +
    askBar +
    `<h2>⚠ Needs attention</h2><div class="attn">${attentionRows}</div>` +
    `<h2 id="fleet">Fleet · click any agent to expand</h2>${fleetSection}` +
    `<div class="grid3">${trustBox(rms, fr)}${proposalBox(props)}${freshBox(fr)}${activityBox(threads)}</div>` +
    `<footer>HartOS Command Center — hosted, read-only. Verdict computed from facts; the cockpit only reads and recommends. ` +
    `No provider / Supabase / ClickUp / Telegram writes. <a href="/health">health</a> · <a href="/api/state">state</a></footer>` +
    `</main></div>` +
    // Quick-peek drawer (card click) + ⌘K command palette — progressive enhancement.
    `<div class="overlay" id="ov"></div>` +
    `<aside class="drawer" id="drawer" aria-hidden="true"><div class="dwrap" id="dbody"></div></aside>` +
    `<div class="overlay" id="kov"></div>` +
    `<div class="kbar" id="kbar"><div class="kbox"><input id="kq" type="text" placeholder="Ask HartOS… (Enter to ask, Esc to close)" autocomplete="off" aria-label="Ask HartOS"><pre class="answer" id="kout" style="display:none;margin:10px 0 0"></pre></div></div>` +
    `<script>
(function(){
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(d){
    if(d&&d.error){return 'Error: '+d.error;}
    var s=(d.title?d.title+'\\n\\n':'')+(d.summary||'');
    if(d.nextSteps&&d.nextSteps.length){s+='\\n\\nNext steps:\\n- '+d.nextSteps.join('\\n- ');}
    if(typeof d.proposalCount==='number'){s+='\\n\\nProposals generated: '+d.proposalCount;}
    return s;
  }
  function ask(text,out){
    if(!text){return;}
    out.style.display='block';out.textContent='…';
    fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:text})})
      .then(function(r){return r.json()}).then(function(d){out.textContent=fmt(d);})
      .catch(function(){out.textContent='Network error.';});
  }
  var q=document.getElementById('q'),inBtn=document.getElementById('ask'),out=document.getElementById('out'),form=document.getElementById('ask-form');
  if(form){form.addEventListener('submit',function(e){e.preventDefault();ask(q.value,out);});}
  if(inBtn){inBtn.addEventListener('click',function(e){e.preventDefault();ask(q.value,out);});}
  Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){c.addEventListener('click',function(){q.value=c.getAttribute('data-q');ask(q.value,out);});});
  var kbar=document.getElementById('kbar'),kov=document.getElementById('kov'),kq=document.getElementById('kq'),kout=document.getElementById('kout');
  function openK(){kov.classList.add('show');kbar.classList.add('show');kq.focus();}
  function closeK(){kov.classList.remove('show');kbar.classList.remove('show');}
  if(kov){kov.addEventListener('click',closeK);}
  if(kq){kq.addEventListener('keydown',function(e){if(e.key==='Enter'){ask(kq.value,kout);}else if(e.key==='Escape'){closeK();}});}
  var ov=document.getElementById('ov'),drawer=document.getElementById('drawer'),dbody=document.getElementById('dbody');
  function closeDrawer(){if(ov){ov.classList.remove('show');}if(drawer){drawer.classList.remove('show');drawer.setAttribute('aria-hidden','true');}}
  function kv(k,v){return '<div class="li"><span>'+esc(k)+'</span><b style="margin-left:auto">'+esc(v==null?'—':v)+'</b></div>';}
  function drawerHtml(domain,d){
    var name=domain.charAt(0).toUpperCase()+domain.slice(1);
    var head='<div class="dhead"><span class="dname">'+esc(name)+'</span><button class="x" id="dx" aria-label="Close">✕</button></div>';
    var link='<div style="margin-top:16px"><a class="btn" href="/agent/'+encodeURIComponent(domain)+'/ui">View full dashboard →</a></div>';
    if(!d||d.available===false){return head+'<div class="muted">'+esc((d&&d.note)||'Detail unavailable. Nothing is fabricated.')+'</div>'+link;}
    var b='<div class="dstatus">status: '+esc(d.status||'—')+'</div>';
    if(d.kind==='generic'&&d.sections){d.sections.forEach(function(s){b+='<div class="dseclbl">'+esc(s.title)+'</div>';(s.rows||[]).slice(0,4).forEach(function(r){b+='<div class="li">'+r.map(esc).join(' · ')+'</div>';});});}
    else if(d.type==='fitness'){var rec=d.recovery||{},n=d.nutrition||{};b+=kv('Recovery',rec.status)+kv('HRV',rec.hrvMs!=null?rec.hrvMs+'ms':null)+kv('Sleep',rec.sleepHours!=null?rec.sleepHours+'h':null)+kv('Calories',n.caloriesConsumed!=null?(n.caloriesConsumed+'/'+(n.caloriesTarget!=null?n.caloriesTarget:'—')):null);}
    else if(d.type==='ops'){var c=d.counts||{};b+=kv('Urgent',c.urgent)+kv('Blocked',c.blocked)+kv('Waiting',c.waiting)+kv('Stale',c.stale);}
    if(d.notes&&d.notes.length){b+='<div class="dseclbl">Notes</div>';d.notes.forEach(function(x){b+='<div class="muted">'+esc(x)+'</div>';});}
    return head+b+link;
  }
  function openDrawer(domain){
    if(!drawer){return;}
    ov.classList.add('show');drawer.classList.add('show');drawer.setAttribute('aria-hidden','false');
    dbody.innerHTML='<div class="muted">Loading '+esc(domain)+'…</div>';
    fetch('/agent/'+encodeURIComponent(domain)).then(function(r){return r.json()}).then(function(d){dbody.innerHTML=drawerHtml(domain,d);}).catch(function(){dbody.innerHTML=drawerHtml(domain,{available:false});});
  }
  if(ov){ov.addEventListener('click',closeDrawer);}
  if(dbody){dbody.addEventListener('click',function(e){if(e.target&&e.target.id==='dx'){closeDrawer();}});}
  Array.prototype.forEach.call(document.querySelectorAll('.card[data-agent]'),function(card){card.addEventListener('click',function(e){e.preventDefault();openDrawer(card.getAttribute('data-agent'));});});
  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();openK();}
    else if(e.key==='Escape'){closeK();closeDrawer();}
  });
})();
</script>`;
  return shell("HartOS Command Center", body);
}

// ─── Login + locked ───────────────────────────────────────────────────────────

/** The access-token login screen. No secret is embedded; the form POSTs to /api/login. */
export function renderLoginPage(opts: { error?: string; redirectTo?: string } = {}): string {
  // Same-origin path only (default "/"). Guard against open-redirect.
  const target =
    typeof opts.redirectTo === "string" && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(opts.redirectTo) ? opts.redirectTo : "/";
  const body =
    `<main><div class="login-card">` +
    `<h1>HartOS Command Center</h1>` +
    `<p class="muted">Read-only hosted cockpit. Enter your access token to continue.</p>` +
    `<input id="t" type="password" placeholder="Access token" autocomplete="current-password" autofocus>` +
    `<button class="btn" id="go" type="button" style="width:100%;margin-top:10px">Sign in</button>` +
    `<div class="err" id="err">${opts.error ? esc(opts.error) : ""}</div>` +
    `</div></main>` +
    `<script>
(function(){
  var t=document.getElementById('t'),go=document.getElementById('go'),err=document.getElementById('err');
  function login(){
    err.textContent='';
    fetch('/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({token:t.value})})
      .then(function(r){return r.json().then(function(d){return {ok:r.ok,d:d}})})
      .then(function(x){ if(x.ok){location.href=${JSON.stringify(target)};} else {err.textContent=(x.d&&x.d.error)||'Sign in failed.';} })
      .catch(function(){err.textContent='Network error.';});
  }
  go.addEventListener('click',login);
  t.addEventListener('keydown',function(e){if(e.key==='Enter')login();});
})();
</script>`;
  return shell("HartOS Command Center — Sign in", body);
}

/** Fail-closed page when auth is required but no access token is configured. */
export function renderLockedPage(): string {
  const body =
    `<main><div class="login-card">` +
    `<h1>HartOS Command Center</h1>` +
    `<span class="verdict r">LOCKED</span>` +
    `<p class="muted" style="margin-top:12px">This cockpit is failing closed: an access token is required but ` +
    `<code>HARTOS_COCKPIT_ACCESS_TOKEN</code> is not configured. Set it as a Wrangler secret and redeploy.</p>` +
    `<p class="muted"><code>wrangler secret put HARTOS_COCKPIT_ACCESS_TOKEN</code></p>` +
    `</div></main>`;
  return shell("HartOS Command Center — Locked", body);
}

// ─── Phase C: per-agent full detail dashboard ─────────────────────────────────

function fmt(n: number | undefined, dp = 0): string {
  if (n === undefined) return "—";
  return dp > 0 ? n.toFixed(dp) : String(Math.round(n));
}

function tableHtml(headers: string[], rows: string[][]): string {
  if (rows.length === 0) return `<p class="muted">None.</p>`;
  const th = headers.map((h) => `<th>${esc(h)}</th>`).join("");
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
  return `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
}

/** Shared detail-page header (back link + read-only badge), used by both renderers. */
function detailHead(label: string): string {
  return (
    `<div class="head"><div><div class="h1"><a href="/">← HartOS</a> &nbsp;/&nbsp; ${esc(label)} dashboard</div>` +
    `<div class="sub">Read-only · live from the agent's own read RPCs</div></div>` +
    `<div class="grow"></div><div class="badge2">read-only</div></div>`
  );
}

// ─── Phase C / Gap C — generic detail render (any registered agent, no bespoke UI)

function renderGenericSection(s: DetailSection): string {
  if (s.kind === "kv") {
    const inner = s.rows.length
      ? s.rows.map((r) => `<div class="li"><span>${esc(r[0] ?? "")}</span><b style="margin-left:auto">${esc(r[1] ?? "—")}</b></div>`).join("")
      : `<p class="muted">None.</p>`;
    return `<section class="box"><div class="blbl">${esc(s.title)}</div>${inner}</section>`;
  }
  return `<section class="box"><div class="blbl">${esc(s.title)}</div>${tableHtml(s.headers, s.rows)}</section>`;
}

/**
 * Render ANY agent that declared a generic detail spec — same Style 5 surface as
 * the bespoke fitness/ops pages, driven entirely by the spec's sections. This is
 * the seam that makes Phase C's DoD literally true: a new agent needs no UI code.
 */
function renderGenericAgentDetailPage(detail: GenericAgentDetail): string {
  const label = detail.label || titleCase(detail.type);
  const t: Tone = detail.status === "ok" ? "g" : detail.status === "degraded" ? "a" : "i";
  const why =
    `<div class="why ${t}"><div class="wt">Read status</div>` +
    `<span class="verdict ${t}">${esc(detail.status.toUpperCase())}</span> ` +
    `${detail.notes.length ? esc(detail.notes.join("; ")) : "All sections resolved."}</div>`;
  const sections = detail.sections.map(renderGenericSection).join("");
  return shell(
    `HartOS — ${label} dashboard`,
    `<main class="main detail">${detailHead(label)}${why}${sections}` +
      `<footer>Read-only, live from the agent's read RPCs. Nothing is fabricated. <a href="/">← back to cockpit</a></footer></main>`,
  );
}

/**
 * The full per-agent dashboard page — recovery + series + bodyweight + nutrition +
 * workouts (fitness), or counts + the full attention list + updates + risk flags
 * (ops). Read-only, grounded in the agent's own read RPCs; an absent detail renders
 * an honest "unavailable" page rather than fabricating data.
 */
export function renderAgentDetailPage(detailInput: AgentDetail | GenericAgentDetail | null, domain: string): string {
  // Gap C — a registered (generic) agent renders through the spec-driven path.
  if (detailInput && "kind" in detailInput && detailInput.kind === "generic") return renderGenericAgentDetailPage(detailInput);
  const detail = detailInput as AgentDetail | null;
  const label = titleCase(domain);
  const head = detailHead(label);

  if (!detail) {
    return shell(
      `HartOS — ${label} dashboard`,
      `<main class="main detail">${head}<div class="box"><div class="blbl">${esc(label)} detail unavailable</div>` +
        `<p class="muted">No live read-model env resolved for ${esc(domain)}. Nothing is fabricated.</p>` +
        `<p><a href="/">← back to cockpit</a></p></div></main>`,
    );
  }

  let sections: string;
  if (detail.type === "fitness") {
    const f = detail;
    const rt = tone(f.recovery.status ?? "unknown", "high", "live");
    sections =
      `<section class="box"><div class="blbl">Recovery</div>` +
      `<div class="why ${rt}"><div class="wt">Recovery verdict</div>` +
      `<span class="verdict ${rt}">${esc((f.recovery.status ?? "unknown").toUpperCase())}</span> &nbsp;` +
      `HRV <b>${fmt(f.recovery.hrvMs)}</b>ms · RHR <b>${fmt(f.recovery.restingHr)}</b> bpm · ` +
      `Sleep <b>${fmt(f.recovery.sleepHours, 1)}</b>h · Plan <b>${esc(f.recovery.trainingDayType ?? "—")}</b>` +
      `${f.recovery.workoutCompleted ? " · completed" : ""}</div></section>` +
      `<section class="box"><div class="blbl">Recovery series</div>${tableHtml(["Date", "HRV (ms)", "RHR (bpm)", "Sleep (h)"], f.series.map((p) => [p.date, fmt(p.hrvMs), fmt(p.restingHr), fmt(p.sleepHours, 1)]))}</section>` +
      `<section class="box"><div class="blbl">Bodyweight</div>${tableHtml(["Date", "kg"], f.bodyweight.map((b) => [b.date, b.kg.toFixed(1)]))}</section>` +
      `<section class="box"><div class="blbl">Nutrition (today)</div><p class="kv">Calories <b>${fmt(f.nutrition.caloriesConsumed)}</b>/${fmt(f.nutrition.caloriesTarget)} · ` +
      `Protein <b>${fmt(f.nutrition.proteinConsumed)}</b>/${fmt(f.nutrition.proteinTarget)}g</p></section>` +
      `<section class="box"><div class="blbl">Recent workouts</div>${tableHtml(["Date", "Type", "Min"], f.workouts.map((w) => [w.date ?? "—", w.type ?? "—", fmt(w.minutes)]))}</section>`;
  } else {
    const o = detail;
    sections =
      `<section class="box"><div class="blbl">Counts</div><p class="kv">Active <b>${fmt(o.counts.active)}</b> · Urgent <b>${fmt(o.counts.urgent)}</b> · ` +
      `Blocked <b>${fmt(o.counts.blocked)}</b> · Waiting <b>${fmt(o.counts.waiting)}</b> · Stale <b>${fmt(o.counts.stale)}</b> · ` +
      `No next action <b>${fmt(o.counts.noNextAction)}</b></p></section>` +
      `<section class="box"><div class="blbl">Attention (full list)</div>${tableHtml(["Title", "Status", "Reason", "Next action", "Due", "Project"], o.attention.map((c) => [c.title, c.status ?? "—", c.reason ?? "—", c.nextAction ?? "—", c.dueAt ?? "—", c.project ?? "—"]))}</section>` +
      `<section class="box"><div class="blbl">Recent updates</div>${tableHtml(["Card", "Summary", "By", "When"], o.updates.map((u) => [u.cardTitle ?? "—", u.summary ?? "—", u.updatedBy ?? "—", u.updatedAt ?? "—"]))}</section>` +
      `<section class="box"><div class="blbl">Risk flags</div>${tableHtml(["Flag", "Severity", "Cards"], o.riskFlags.map((r) => [r.flag, r.severity ?? "—", fmt(r.cardCount)]))}</section>`;
  }

  const notes = detail.notes.length ? `<section class="box"><div class="blbl">Data notes</div>${listHtml(detail.notes)}</section>` : "";
  return shell(
    `HartOS — ${label} dashboard`,
    `<main class="main detail">${head}${sections}${notes}` +
      `<footer>Read-only, live from the agent's read RPCs. Nothing is fabricated. <a href="/">← back to cockpit</a></footer></main>`,
  );
}
