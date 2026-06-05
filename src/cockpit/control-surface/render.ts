/**
 * src/cockpit/control-surface/render.ts
 *
 * Phase 18E — the renderer. Produces a single, self-contained HTML document
 * (inline CSS + vanilla JS, no framework) for the Operator Brief light theme,
 * anchored to the locked mockup `5-mission-builder-drawer.html`.
 *
 * It renders ENTIRELY from the assembled bundles — there is no hardcoded
 * per-agent markup, so a new agent appears with zero UI surgery. Every action is
 * approve / reject / explain / copy-CLI / open. There is NO execute button: the
 * client JS has no fetch/mutation path at all.
 */

import type { AgentFactBundle, Fact, FixSeverity, Verdict } from "./fact-bundle.js";
import type { ControlSurfaceState } from "./assemble.js";
import type { LifecycleStep } from "./lifecycle.js";

export interface AttentionItem {
  agentId: string;
  severity: FixSeverity;
  title: string;
  why: string;
  action: { kind: string; payload: string };
}

export interface BuilderView {
  agentName: string;
  specId: string | null;
  status: string;
  steps: LifecycleStep[];
  worker: string;
  environment: string;
  webhook: string;
  trigger: string;
  nextStep: string;
  /** Secret NAMES + present/missing only — never values. */
  credentials: Array<{ name: string; present: boolean }>;
  missingCredentials: string[];
}

export interface ControlSurfaceRender extends ControlSurfaceState {
  systemVerdict: Verdict;
  attention: AttentionItem[];
  builder: BuilderView | null;
}

export interface RenderOptions {
  /** Coarse "refreshed Nm ago" hint for the top bar (display only). */
  refreshedLabel?: string;
}

const VCLASS: Record<Verdict, string> = { GREEN: "g", AMBER: "a", RED: "r", UNKNOWN: "i" };
const SEV_LABEL: Record<FixSeverity, string> = {
  security: "security",
  "stale-revenue": "stale · revenue",
  blocked: "blocked",
  next: "next step",
  note: "note",
};
const SEV_CLASS: Record<FixSeverity, string> = {
  security: "sec",
  "stale-revenue": "hi",
  blocked: "hi",
  next: "",
  note: "",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function factChip(f: Fact): string {
  if (f.value === null) return `<span><b>—</b> ${escapeHtml(f.label)}</span>`;
  const unit = f.unit ? ` ${escapeHtml(f.unit)}` : "";
  return `<span><b>${escapeHtml(String(f.value))}</b>${unit} ${escapeHtml(f.label)}</span>`;
}

function confClass(c: AgentFactBundle["confidence"]): string {
  return c === "HIGH" ? "high" : c === "UNKNOWN" ? "low" : "low";
}

function renderCard(b: AgentFactBundle): string {
  const v = VCLASS[b.verdict];
  const selected = b.selectedFactKeys.length
    ? b.selectedFactKeys.map((k) => b.facts.find((f) => f.key === k)).filter((f): f is Fact => Boolean(f))
    : b.facts.slice(0, 3);
  const stat = b.unavailable ? "unknown · data unavailable" : `${b.confidence === "HIGH" ? "live · fresh" : b.confidence === "LOW" ? "stale" : "unknown"}`;
  const summaryText = b.summary.text || "—";
  const staleBadge = b.summary.stale ? ` <span class="conf low">summary stale</span>` : "";
  return `<div class="card${b.unavailable ? " unavailable" : ""}" data-agent="${escapeHtml(b.agentId)}" onclick="openDrawer('${escapeHtml(b.agentId)}')">
    <div class="ctop"><span class="ico ${v}">${b.icon}</span><span class="cname">${escapeHtml(b.name)}</span><span class="vpill ${v}">${b.verdict}</span></div>
    <div class="cstat">${escapeHtml(stat)}</div>
    <div class="facts">${selected.map(factChip).join("")}</div>
    <div class="sum">${escapeHtml(summaryText)}</div>
    <div class="meta"><span class="conf ${confClass(b.confidence)}">${b.confidence}</span>${staleBadge}<span class="expandhint">expand ↗</span></div>
  </div>`;
}

function renderAttentionRow(item: AttentionItem, rank: number): string {
  const sevClass = SEV_CLASS[item.severity];
  const label = SEV_LABEL[item.severity];
  const actionLabel =
    item.action.kind === "copy_cli" ? "Copy command" : item.action.kind === "open_proposal" ? "Open proposal" : "Open";
  return `<div class="row"><span class="rk${item.severity === "security" || item.severity === "stale-revenue" ? "" : " ok"}">${rank}</span>
    <span class="sev ${sevClass}">${escapeHtml(label)}</span>
    ${escapeHtml(item.title)}
    <span class="act">
      <button class="btn" data-action="${escapeHtml(item.action.kind)}" data-payload="${escapeHtml(item.action.payload)}">${actionLabel}</button>
      <button class="btn ghost" onclick="openDrawer('${escapeHtml(item.agentId)}')">Explain</button>
    </span></div>`;
}

function renderBuilder(b: BuilderView): string {
  const steps = b.steps
    .map((s) => {
      const cls = s.state === "done" ? "done" : s.state === "now" ? "now" : "future";
      const node = s.state === "done" ? "✓" : s.state === "now" ? "●" : "○";
      return `<div class="step ${cls}"><div class="node">${node}</div><div class="slbl">${escapeHtml(s.label)}</div></div>`;
    })
    .join("");
  const creds = b.credentials
    .map((c) => `<div class="kv"><span class="k">${escapeHtml(c.name)}</span><span class="v ${c.present ? "ok" : "warn"}">${c.present ? "✓" : "missing"}</span></div>`)
    .join("");
  return `<section id="builder" class="hide">
    <div class="head"><div><div class="h1">Agent Builder</div><div class="sub">Lifecycle reads the proposal's real status</div></div></div>
    <div class="panel">
      <div style="display:flex;align-items:center;margin-bottom:18px">
        <div style="font-weight:800;letter-spacing:.5px">${escapeHtml(b.agentName.toUpperCase())} · LIFECYCLE</div>
        <span class="vpill g" style="margin-left:12px">${escapeHtml(b.status)}</span>
        <span style="margin-left:auto;font-size:11px;color:var(--faint)">spec: ${escapeHtml(b.specId ?? "—")}</span>
      </div>
      <div class="life">${steps}</div>
    </div>
    <div class="grid3" style="margin-top:14px">
      <div class="box">
        <div class="blbl">Current status</div>
        <div class="kv"><span class="k">Worker</span><span class="v ok">${escapeHtml(b.worker)}</span></div>
        <div class="kv"><span class="k">Environment</span><span class="v">${escapeHtml(b.environment)}</span></div>
        <div class="kv"><span class="k">Webhook</span><span class="v">${escapeHtml(b.webhook)}</span></div>
        <div class="kv"><span class="k">Trigger</span><span class="v warn">${escapeHtml(b.trigger)}</span></div>
        <div class="kv"><span class="k">Next step</span><span class="v" style="color:var(--primary)">${escapeHtml(b.nextStep)}</span></div>
      </div>
      <div class="box">
        <div class="blbl">Credentials</div>
        <div class="kv"><span class="k">Missing</span><span class="v ${b.missingCredentials.length ? "warn" : "ok"}">${b.missingCredentials.length ? escapeHtml(b.missingCredentials.join(", ")) : "none"}</span></div>
        ${creds}
        <div style="font-size:11px;color:var(--faint);margin-top:8px">Values stay local · cockpit never holds raw secrets</div>
      </div>
      <div class="box">
        <div class="blbl">Note</div>
        <div class="li">Credential values are captured locally via CLI. This panel shows names + presence only.</div>
      </div>
    </div>
    <div class="cap">Builder · lifecycle reads the proposal's real status.</div>
  </section>`;
}

function homeRow(state: ControlSurfaceRender): string {
  const health = state.systemHealth
    .map((h) => `<div class="li"><span class="dot ${h.state === "unknown" ? "i" : h.state}"></span>${escapeHtml(h.name)} <b style="margin-left:auto${h.state === "i" || h.state === "unknown" ? ";color:var(--faint)" : ""}">${escapeHtml(h.detail)}</b></div>`)
    .join("");
  const q = state.proposalQueue;
  const activity = state.recentActivity
    .slice(0, 4)
    .map((a) => `<div class="li"><span class="dot ${a.level}"></span>${escapeHtml(a.text)} <span style="margin-left:auto;color:var(--faint);font-size:11px">${escapeHtml(a.at)}</span></div>`)
    .join("");
  return `<div class="grid3">
    <div class="box"><div class="blbl">System health</div>${health || '<div class="li">No providers reported</div>'}</div>
    <div class="box"><div class="blbl">Proposal queue</div>
      <div class="li">Needs approval <span class="tag app">${q.needsApproval}</span></div>
      <div class="li">Ready locally <span class="tag loc">${q.readyLocal}</span></div>
      <div class="li">Blocked <span class="tag zero">${q.blocked}</span></div>
      <div class="li">Completed <span class="tag zero">${q.completed}</span></div>
    </div>
    <div class="box"><div class="blbl">Recent activity</div>${activity || '<div class="li">No recent activity</div>'}</div>
  </div>`;
}

export function renderControlSurfaceHtml(state: ControlSurfaceRender, options: RenderOptions = {}): string {
  const sysV = VCLASS[state.systemVerdict];
  const refreshed = options.refreshedLabel ?? `as of ${state.generatedAt}`;
  const cards = state.bundles.map(renderCard).join("");
  const hasHard = state.attention.some((a) => a.severity === "security" || a.severity === "stale-revenue" || a.severity === "blocked");
  const attentionRows =
    state.attention.map((item, i) => renderAttentionRow(item, i + 1)).join("") +
    (hasHard ? "" : `<div class="row"><span class="rk ok">✓</span><span style="color:var(--green);font-weight:700">No red system-health issues</span></div>`);
  const builder = state.builder ? renderBuilder(state.builder) : "";

  // Drawer payload — bundles only (already secret-checked in applySummary). No secrets, no actions.
  const drawerData = JSON.stringify(
    state.bundles.map((b) => ({
      id: b.agentId,
      icon: b.icon,
      cls: VCLASS[b.verdict],
      name: b.name,
      purpose: b.purpose,
      verdict: b.verdict,
      whyVerdict: b.whyVerdict,
      facts: b.facts.map((f) => ({ k: f.label, v: f.value === null ? "—" : `${f.value}${f.unit ? ` ${f.unit}` : ""}`, src: `${f.source}${f.asOf ? ` · ${f.freshness}` : ""}` })),
      health: b.health.map((h) => [h.name, h.detail, h.state]),
      fixes: b.fixes.map((x) => ({ sev: SEV_LABEL[x.severity], sevcls: SEV_CLASS[x.severity], t: x.title, why: x.why, actLabel: x.action.kind === "copy_cli" ? "Copy command" : x.action.kind === "open_proposal" ? "Open proposal" : "Open", kind: x.action.kind, payload: x.action.payload })),
      caps: b.capabilities,
      perms: b.permissions,
      audit: b.audit.map((a) => [a.event, a.at, a.level === "a" ? "amb" : a.level]),
    }))
  ).replace(/</g, "\\u003c");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HartOS — Cockpit Control Surface</title>
<style>${CSS}</style></head>
<body>
<div class="app">
  <aside class="side">
    <div class="brand"><span class="mk">◆</span> HartOS</div>
    <div class="nav active" data-view="home"><span class="ic">⌂</span> Home</div>
    <div class="nav" data-view="builder"><span class="ic">⚒</span> Builder</div>
  </aside>
  <main class="main">
    <section id="home">
      <div class="head">
        <div><div class="h1">Command Center</div><div class="sub">Mission Control · fleet overview</div></div>
        <div class="grow"></div>
        <div class="statwrap"><div class="statlbl">SYSTEM STATUS</div><span class="pill ${sysV}"><span class="dot ${sysV}"></span>${state.systemVerdict}</span><div class="sub">${escapeHtml(refreshed)}</div></div>
      </div>
      <div class="ask">Ask HartOS anything… <span class="send">➤</span></div>
      <h2>⚠ Needs attention</h2>
      <div class="attn">${attentionRows}</div>
      <h2>Fleet · click any agent to expand</h2>
      <div class="grid4">${cards}</div>
      ${homeRow(state)}
      <div class="cap">Click any agent card (or Explain) → detail drawer with per-agent health + fix recommendations. Nothing here executes — every action is copy-CLI / open / approve.</div>
    </section>
    ${builder}
  </main>
</div>
<div class="overlay" id="overlay" onclick="closeDrawer()"></div>
<aside class="drawer" id="drawer"><div class="dwrap" id="dbody"></div></aside>
<script>window.__CS__=${drawerData};</script>
<script>${CLIENT_JS}</script>
</body></html>`;
}

const CSS = `:root{--bg:#f3f6fa;--panel:#fff;--line:#e6eaf1;--line2:#eef2f7;--txt:#1b2532;--dim:#5f6e80;--faint:#9aa6b6;--green:#15a06a;--amber:#df8a0b;--red:#e0455a;--idle:#b3bdca;--sg:#e7f6ef;--sa:#fcf3e2;--sb:#eef0fe;--sr:#fdecef;--primary:#6b4ef0;--primaryH:#5b3fe0;--accent:#2f6df6;--sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--txt);font-family:var(--sans);font-size:13.5px}
.app{display:grid;grid-template-columns:208px 1fr;min-height:100vh}
.side{background:var(--panel);border-right:1px solid var(--line);padding:16px 12px;display:flex;flex-direction:column;gap:3px}
.brand{display:flex;align-items:center;gap:9px;font-weight:800;padding:6px 8px 14px}
.brand .mk{width:24px;height:24px;border-radius:7px;background:linear-gradient(135deg,var(--primary),#9a7bff);display:grid;place-items:center;color:#fff;font-size:13px}
.nav{display:flex;align-items:center;gap:10px;padding:9px 11px;border-radius:9px;color:var(--dim);cursor:pointer;font-weight:600}
.nav:hover{background:var(--bg)}.nav.active{background:var(--sb);color:var(--primary)}.nav .ic{width:16px;text-align:center;opacity:.85}
.main{padding:22px 26px}.head{display:flex;align-items:flex-start;gap:14px;margin-bottom:18px}
.h1{font-size:21px;font-weight:800;letter-spacing:-.3px}.sub{color:var(--faint);font-size:12.5px;margin-top:2px}.grow{flex:1}
.statwrap{text-align:right}.statlbl{font-size:10px;letter-spacing:1px;color:var(--faint);font-weight:700}
.pill{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:8px;font-weight:800;font-size:12px;margin-top:5px}
.pill.a{background:var(--sa);color:var(--amber)}.pill.g{background:var(--sg);color:var(--green)}.pill.r{background:var(--sr);color:var(--red)}.pill.i{background:#eef2f7;color:var(--faint)}
.dot{width:9px;height:9px;border-radius:50%;display:inline-block}.g{background:var(--green)}.a{background:var(--amber)}.r{background:var(--red)}.i{background:var(--idle)}
.ask{display:flex;align-items:center;gap:10px;background:var(--panel);border:1px solid var(--line);border-radius:11px;padding:11px 15px;color:var(--faint);margin-bottom:18px;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.ask .send{margin-left:auto;width:30px;height:30px;border-radius:8px;background:var(--primary);display:grid;place-items:center;color:#fff}
h2{font-size:11px;letter-spacing:1.2px;color:var(--faint);text-transform:uppercase;margin:22px 4px 11px;font-weight:800}
.attn{border:1px solid var(--line);border-radius:13px;background:var(--panel);overflow:hidden;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.attn .row{display:flex;align-items:center;gap:13px;padding:13px 17px;border-top:1px solid var(--line2)}.attn .row:first-child{border-top:none}
.rk{width:22px;height:22px;border-radius:50%;background:var(--sa);color:var(--amber);display:grid;place-items:center;font-weight:800;font-size:12px}.rk.ok{background:var(--sg);color:var(--green)}
.sev{font-size:10.5px;padding:2px 8px;border-radius:6px;background:#f1f4f8;color:var(--dim);font-weight:700}.sev.hi{background:var(--sa);color:var(--amber)}.sev.sec{background:var(--sr);color:var(--red)}
.act{margin-left:auto;display:flex;gap:8px}
.btn{font:inherit;font-size:12px;font-weight:700;border:1px solid var(--line);background:#fff;color:var(--accent);border-radius:8px;padding:6px 13px;cursor:pointer}.btn:hover{background:var(--sb)}.btn.ghost{color:var(--dim)}
.grid4{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.card{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:16px;display:flex;flex-direction:column;gap:10px;box-shadow:0 1px 2px rgba(20,40,70,.04);cursor:pointer;transition:transform .12s,box-shadow .12s,border-color .12s}
.card:hover{transform:translateY(-2px);box-shadow:0 6px 18px rgba(20,40,70,.10);border-color:#d4dbe6}
.card.unavailable{background:repeating-linear-gradient(45deg,#fff,#fff 8px,#fafbfd 8px,#fafbfd 16px)}
.ctop{display:flex;align-items:center;gap:8px}.ico{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-size:14px}
.ico.g{background:var(--sg)}.ico.a{background:var(--sa)}.ico.r{background:var(--sr)}.ico.i{background:#eef2f7}
.cname{font-weight:800}.vpill{margin-left:auto;font-size:10px;font-weight:800;padding:3px 8px;border-radius:6px}
.vpill.g{background:var(--sg);color:var(--green)}.vpill.a{background:var(--sa);color:var(--amber)}.vpill.r{background:var(--sr);color:var(--red)}.vpill.i{background:#eef2f7;color:var(--faint)}
.cstat{font-size:11px;color:var(--faint);font-weight:600}
.facts{display:flex;flex-wrap:wrap;gap:4px 14px;color:var(--dim);font-size:12.5px}.facts b{color:var(--txt);font-weight:700}
.sum{color:#3c4a59;border-top:1px solid var(--line2);padding-top:9px;font-size:12.5px;line-height:1.45}
.meta{display:flex;align-items:center;gap:8px;margin-top:auto}.conf{font-size:10px;padding:3px 8px;border-radius:6px;font-weight:800}
.conf.high{background:var(--sg);color:var(--green)}.conf.low{background:var(--sa);color:var(--amber)}.expandhint{margin-left:auto;font-size:11.5px;color:var(--primary);font-weight:700}
.grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-top:14px}
.box{border:1px solid var(--line);border-radius:13px;background:var(--panel);padding:15px 17px;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.blbl{color:var(--faint);font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;margin-bottom:10px}
.li{display:flex;align-items:center;gap:9px;padding:6px 0;color:var(--dim);font-size:12.5px}.li b{color:var(--txt)}
.tag{margin-left:auto;font-size:10px;font-weight:800;border-radius:6px;padding:2px 8px}.tag.app{background:var(--sa);color:var(--amber)}.tag.loc{background:var(--sb);color:var(--primary)}.tag.zero{background:#eef2f7;color:var(--faint)}
.panel{border:1px solid var(--line);border-radius:14px;background:var(--panel);padding:22px;box-shadow:0 1px 2px rgba(20,40,70,.04)}
.life{display:flex;align-items:flex-start;justify-content:space-between;margin:6px 0 4px}
.step{display:flex;flex-direction:column;align-items:center;gap:8px;flex:1;position:relative}
.step:not(:last-child)::after{content:"";position:absolute;top:18px;left:50%;width:100%;height:2px;background:var(--line);z-index:0}.step.done:not(:last-child)::after{background:var(--green)}
.node{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:800;z-index:1;border:2px solid var(--line);background:#fff;color:var(--faint)}
.step.done .node{background:var(--green);border-color:var(--green);color:#fff}.step.now .node{background:#fff;border-color:var(--primary);color:var(--primary);box-shadow:0 0 0 4px var(--sb)}
.slbl{font-size:11px;font-weight:700;color:var(--dim);text-align:center;max-width:84px}.step.now .slbl{color:var(--primary)}.step.future .slbl{color:var(--faint)}
.kv{display:flex;justify-content:space-between;padding:7px 0;border-top:1px solid var(--line2);font-size:12.5px}.kv:first-child{border-top:none}.kv .k{color:var(--dim)}.kv .v{font-weight:700}.ok{color:var(--green)}.warn{color:var(--amber)}
.hide{display:none}.cap{color:var(--faint);font-size:11px;margin:18px 4px 0;text-align:center}
.overlay{position:fixed;inset:0;background:rgba(20,30,45,.34);opacity:0;pointer-events:none;transition:opacity .2s;z-index:40}.overlay.show{opacity:1;pointer-events:auto}
.drawer{position:fixed;top:0;right:0;height:100vh;width:460px;max-width:92vw;background:var(--panel);border-left:1px solid var(--line);box-shadow:-12px 0 40px rgba(20,40,70,.16);transform:translateX(100%);transition:transform .26s cubic-bezier(.4,0,.2,1);z-index:50;overflow-y:auto}.drawer.show{transform:translateX(0)}
.dwrap{padding:20px 22px 40px}.dhead{display:flex;align-items:center;gap:11px;margin-bottom:4px}.dico{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-size:17px}.dname{font-size:18px;font-weight:800}
.x{margin-left:auto;width:30px;height:30px;border-radius:8px;border:1px solid var(--line);background:#fff;cursor:pointer;color:var(--dim);font-size:15px}
.dpurpose{color:var(--faint);font-size:12.5px;margin-bottom:14px}
.why{border-radius:11px;padding:12px 14px;font-size:12.5px;line-height:1.5;margin-bottom:8px}.why.g{background:var(--sg)}.why.a{background:var(--sa)}.why.r{background:var(--sr)}.why.i{background:#eef2f7}
.why .wt{font-weight:800;font-size:11px;letter-spacing:.5px;text-transform:uppercase;margin-bottom:4px}.why.g .wt{color:var(--green)}.why.a .wt{color:var(--amber)}.why.r .wt{color:var(--red)}.why.i .wt{color:var(--faint)}
.dsec{margin-top:18px}.dseclbl{font-size:10.5px;font-weight:800;letter-spacing:.8px;text-transform:uppercase;color:var(--faint);margin-bottom:9px}
.fct{display:flex;align-items:baseline;gap:8px;padding:7px 0;border-top:1px solid var(--line2);font-size:12.5px}.fct:first-child{border-top:none}.fct .fk{color:var(--dim);min-width:96px}.fct .fv{font-weight:700}.fct .fsrc{margin-left:auto;font-size:10.5px;color:var(--faint)}
.rec{border:1px solid var(--line);border-radius:11px;padding:11px 13px;margin-bottom:9px}.rec .rtop{display:flex;align-items:center;gap:9px;margin-bottom:5px}.rec .rt{font-weight:700;font-size:13px}.rec .why2{color:var(--dim);font-size:12px;line-height:1.45;margin-bottom:9px}.rec .racts{display:flex;gap:8px}
.recnone{color:var(--green);font-size:12.5px;background:var(--sg);border-radius:10px;padding:11px 13px;font-weight:600}
.tline{position:relative;padding-left:16px}.tline .te{position:relative;padding:5px 0;color:var(--dim);font-size:12px;display:flex;gap:8px;align-items:center}.tline .te::before{content:"";position:absolute;left:-13px;top:10px;width:7px;height:7px;border-radius:50%;background:var(--green)}.tline .te.amb::before{background:var(--amber)}.tline .te .tt{margin-left:auto;color:var(--faint);font-size:10.5px}
.chips{display:flex;flex-wrap:wrap;gap:6px}.chip{font-size:11px;border:1px solid var(--line);border-radius:6px;padding:3px 9px;color:var(--dim);background:#fafbfd}.chip.no{color:var(--red);border-color:#f1d4da;background:var(--sr)}`;

// Client JS: drawer rendering + nav + copy-to-clipboard. NO fetch, NO mutation path.
const CLIENT_JS = `var A={};(window.__CS__||[]).forEach(function(a){A[a.id]=a});
function esc(s){return String(s).replace(/[&<>"']/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]})}
function rec(r){return '<div class="rec"><div class="rtop"><span class="sev '+r.sevcls+'">'+esc(r.sev)+'</span><span class="rt">'+esc(r.t)+'</span></div><div class="why2">'+esc(r.why)+'</div><div class="racts"><button class="btn" data-action="'+esc(r.kind)+'" data-payload="'+esc(r.payload)+'">'+esc(r.actLabel)+'</button></div></div>'}
function openDrawer(key){var a=A[key];if(!a)return;
document.getElementById('dbody').innerHTML='<div class="dhead"><span class="dico ico '+a.cls+'">'+a.icon+'</span><span class="dname">'+esc(a.name)+'</span><button class="x" onclick="closeDrawer()">✕</button></div>'+
'<div class="dpurpose">'+esc(a.purpose)+'</div>'+
'<div class="why '+a.cls+'"><div class="wt">Why '+esc(a.verdict)+'?</div>'+esc(a.whyVerdict)+'</div>'+
'<div class="dsec"><div class="dseclbl">Facts · with freshness + source</div>'+a.facts.map(function(f){return '<div class="fct"><span class="fk">'+esc(f.k)+'</span><span class="fv">'+esc(f.v)+'</span><span class="fsrc">'+esc(f.src)+'</span></div>'}).join('')+'</div>'+
'<div class="dsec"><div class="dseclbl">Agent system health</div>'+a.health.map(function(h){return '<div class="li"><span class="dot '+(h[2]==='unknown'?'i':h[2])+'"></span>'+esc(h[0])+'<b style="margin-left:auto">'+esc(h[1])+'</b></div>'}).join('')+'</div>'+
'<div class="dsec"><div class="dseclbl">Fix recommendations</div>'+(a.fixes.length?a.fixes.map(rec).join(''):'<div class="recnone">✓ No action needed — everything healthy and fresh.</div>')+'</div>'+
'<div class="dsec"><div class="dseclbl">Capabilities &amp; permissions</div><div class="chips">'+a.caps.map(function(c){return '<span class="chip">'+esc(c)+'</span>'}).join('')+a.perms.map(function(p){return '<span class="chip '+(/never|no /.test(p)?'no':'')+'">🔒 '+esc(p)+'</span>'}).join('')+'</div></div>'+
'<div class="dsec"><div class="dseclbl">Recent audit trail</div><div class="tline">'+(a.audit.length?a.audit.map(function(t){return '<div class="te '+(t[2]==='amb'?'amb':'')+'">'+esc(t[0])+'<span class="tt">'+esc(t[1])+'</span></div>'}).join(''):'<div class="te">No audit events</div>')+'</div></div>';
document.getElementById('overlay').classList.add('show');document.getElementById('drawer').classList.add('show')}
function closeDrawer(){document.getElementById('overlay').classList.remove('show');document.getElementById('drawer').classList.remove('show')}
document.addEventListener('keydown',function(e){if(e.key==='Escape')closeDrawer()});
document.addEventListener('click',function(e){var b=e.target.closest('button[data-action]');if(!b)return;var k=b.getAttribute('data-action'),p=b.getAttribute('data-payload');
if(k==='copy_cli'&&navigator.clipboard){navigator.clipboard.writeText(p);b.textContent='Copied ✓';setTimeout(function(){b.textContent='Copy command'},1200)}
else if(k==='open_link'){/* operator opens manually — surface only */b.textContent='See: '+p;}
else if(k==='open_proposal'){b.textContent='Proposal: '+p;}});
var navs=[].slice.call(document.querySelectorAll('.nav'));navs.forEach(function(n){n.addEventListener('click',function(){navs.forEach(function(x){x.classList.remove('active')});n.classList.add('active');document.getElementById('home').classList.toggle('hide',n.dataset.view!=='home');var bld=document.getElementById('builder');if(bld)bld.classList.toggle('hide',n.dataset.view!=='builder');window.scrollTo(0,0)})});`;
