/**
 * src/runtime/views/cockpit-v3-fx.ts — Cockpit V3: the JARVIS / command-bridge visual system.
 *
 * Pure string builders, ZERO dependencies, fully self-contained (no CDN, no fonts, no images).
 * V3 is a SKIN + MOTION layer over the existing server-rendered cockpit: every existing id /
 * class / data-attribute / text node is untouched (the inline JS contract and the test pins all
 * keep working). It adds four things:
 *
 *   1. V3_STYLE        — the design-system overlay (layered atmosphere, holo glass, motion).
 *   2. bootOverlayHtml — the optional startup sequence (honest per-agent statuses, once per
 *                        session, skippable, reduced-motion-safe, works without JS).
 *   3. coreStatusHtml + arc-reactor CSS — the system heartbeat ("HARTOS CORE").
 *   4. fleetTopologyHtml — the fleet as a living network, driven by the REAL meta-agent
 *                        registry (reportsTo edges + statuses) — never fabricated.
 *   5. v3ClientScript  — count-up numbers, staggered view reveals, boot dismissal. Progressive
 *                        enhancement only; the page is complete without it.
 *
 * Performance doctrine (non-negotiable):
 *   - Continuous animations use transform/opacity (compositor-only); no layout/paint loops.
 *   - The atmosphere is two fixed pseudo-layers + one beam; all are disabled on small screens
 *     and under prefers-reduced-motion. No JS animation loops persist (count-up is one-shot rAF).
 *   - Every effect must justify itself; anything gamer-ish was cut.
 */

import type { MetaAgentRegistry, MetaAgent } from "../../agents/meta-agent-registry.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ─── 1. The V3 design-system overlay ──────────────────────────────────────────

export const V3_STYLE = `
/* ═══════════ Cockpit V3 — JARVIS command-bridge skin (motion + depth overlay) ═══════════ */
:root{
  --v3-ice:#9BE8FF;--v3-core:#22D3EE;--v3-deep:#030509;
  --v3-ring:rgba(34,211,238,.55);--v3-grid:rgba(56,189,248,.05);
  --spring:cubic-bezier(.22,1.4,.36,1);
}
html{scrollbar-color:rgba(34,211,238,.35) transparent}
body{background:
  radial-gradient(1100px 700px at 18% -12%, rgba(34,211,238,.085), transparent 60%),
  radial-gradient(900px 600px at 102% -4%, rgba(125,140,255,.075), transparent 55%),
  radial-gradient(1400px 900px at 50% 120%, rgba(14,40,70,.35), transparent 70%),
  var(--v3-deep) fixed}
/* Layer 0a — perspective grid floor (fixed, compositor-only drift) */
body::before{content:"";position:fixed;inset:0;z-index:0;pointer-events:none;
  background:
    linear-gradient(var(--v3-grid) 1px, transparent 1px),
    linear-gradient(90deg, var(--v3-grid) 1px, transparent 1px);
  background-size:44px 44px;
  -webkit-mask-image:radial-gradient(900px 640px at 50% 18%, rgba(0,0,0,.9), transparent 78%);
  mask-image:radial-gradient(900px 640px at 50% 18%, rgba(0,0,0,.9), transparent 78%)}
/* Layer 0b — particle field (two star layers, slow vertical drift) */
body::after{content:"";position:fixed;inset:-50% 0 0 0;z-index:0;pointer-events:none;opacity:.5;
  background-image:
    radial-gradient(1.5px 1.5px at 22% 31%, rgba(155,232,255,.55), transparent 100%),
    radial-gradient(1px 1px at 67% 12%, rgba(155,232,255,.4), transparent 100%),
    radial-gradient(1px 1px at 44% 64%, rgba(167,139,250,.35), transparent 100%),
    radial-gradient(1.5px 1.5px at 81% 49%, rgba(155,232,255,.45), transparent 100%),
    radial-gradient(1px 1px at 12% 82%, rgba(155,232,255,.3), transparent 100%),
    radial-gradient(1px 1px at 92% 88%, rgba(167,139,250,.3), transparent 100%);
  background-size:520px 520px;
  animation:v3drift 90s linear infinite}
@keyframes v3drift{from{transform:translateY(0)}to{transform:translateY(520px)}}
/* Layer 0c — a single slow scan beam (adds "alive", costs one compositor layer) */
.v3beam{position:fixed;left:0;right:0;top:-2px;height:2px;z-index:1;pointer-events:none;opacity:.5;
  background:linear-gradient(90deg, transparent, rgba(34,211,238,.18) 30%, rgba(34,211,238,.34) 50%, rgba(34,211,238,.18) 70%, transparent);
  filter:blur(.5px);
  animation:v3beam 13s ease-in-out infinite}
@keyframes v3beam{0%{transform:translateY(0);opacity:0}6%{opacity:.5}50%{transform:translateY(100vh);opacity:.35}56%{opacity:0}100%{transform:translateY(0);opacity:0}}
/* content sits above the atmosphere */
.app2,.app,main,.botnav,.drawer,.kbar,.overlay,.askcli{position:relative;z-index:2}
.rail,.tb{z-index:21}

/* ── Holo glass panels: corner brackets + scan-line texture + lift on hover ── */
.card,.box,.htile{position:relative;
  background:
    linear-gradient(180deg, rgba(56,189,248,.045), transparent 38%),
    repeating-linear-gradient(0deg, rgba(155,232,255,.014) 0 1px, transparent 1px 3px),
    var(--panel);
  transition:transform .34s var(--spring), box-shadow .34s ease, border-color .34s ease}
.card::after,.htile.lead::after{content:"";position:absolute;inset:0;border-radius:inherit;pointer-events:none;
  background:
    linear-gradient(var(--v3-ring), var(--v3-ring)) top left/14px 1.5px,
    linear-gradient(var(--v3-ring), var(--v3-ring)) top left/1.5px 14px,
    linear-gradient(var(--v3-ring), var(--v3-ring)) bottom right/14px 1.5px,
    linear-gradient(var(--v3-ring), var(--v3-ring)) bottom right/1.5px 14px;
  background-repeat:no-repeat;opacity:.28;transition:opacity .3s ease}
.card:hover{transform:translateY(-3px);border-color:rgba(34,211,238,.5)}
.card:hover::after{opacity:.85}
.htile{overflow:hidden}
.htile.lead .vbig{text-shadow:0 0 22px rgba(34,211,238,.25)}
.box{transition:border-color .3s ease, box-shadow .3s ease}
.box:hover{border-color:rgba(34,211,238,.3)}
/* status dots: every tone breathes (severity-paced) */
.dot.g{animation:v3breath 3.4s ease-in-out infinite}
.dot.a{animation:v3breathA 2.4s ease-in-out infinite}
@keyframes v3breath{0%,100%{box-shadow:0 0 6px rgba(52,224,161,.5)}50%{box-shadow:0 0 12px rgba(52,224,161,.95)}}
@keyframes v3breathA{0%,100%{box-shadow:0 0 6px rgba(245,196,81,.45)}50%{box-shadow:0 0 12px rgba(245,196,81,.9)}}
/* monospace data voice for numbers */
.htile .big,.facts b,.tstamp,.frq{font-family:var(--mono);font-variant-numeric:tabular-nums}

/* ── ARC REACTOR — the System tile becomes the HARTOS CORE heartbeat ── */
.sysv{min-height:158px}
.sysv .big{position:relative;z-index:2}
.sysv::before,.sysv::after{content:"";position:absolute;left:50%;top:50%;border-radius:50%;pointer-events:none}
.sysv::before{width:118px;height:118px;margin:-59px 0 0 -59px;
  border:1.5px solid rgba(34,211,238,.34);
  box-shadow:0 0 24px rgba(34,211,238,.18), inset 0 0 24px rgba(34,211,238,.12);
  animation:v3corebreath 4.2s ease-in-out infinite}
.sysv::after{width:138px;height:138px;margin:-69px 0 0 -69px;
  border:1px dashed rgba(34,211,238,.30);border-top-color:rgba(155,232,255,.8);
  animation:v3corespin 9s linear infinite}
.htile.a .sysv::before,.htile.a.sysv::before{border-color:rgba(245,196,81,.4);box-shadow:0 0 24px rgba(245,196,81,.16), inset 0 0 22px rgba(245,196,81,.1)}
.htile.r .sysv::before,.htile.r.sysv::before{border-color:rgba(255,107,107,.45);box-shadow:0 0 26px rgba(255,107,107,.2), inset 0 0 22px rgba(255,107,107,.12)}
@keyframes v3corespin{to{transform:rotate(360deg)}}
@keyframes v3corebreath{0%,100%{transform:scale(1);opacity:.85}50%{transform:scale(1.045);opacity:1}}
/* topbar core chip */
.core{display:inline-flex;align-items:center;gap:8px;font-family:var(--mono);font-size:10.5px;letter-spacing:1.2px;color:var(--v3-ice);opacity:.9;white-space:nowrap}
.core .cring{width:13px;height:13px;border-radius:50%;border:1.5px solid var(--v3-ring);position:relative;flex:0 0 auto;
  box-shadow:0 0 10px rgba(34,211,238,.45), inset 0 0 5px rgba(34,211,238,.5);
  animation:v3corebreath 3.2s ease-in-out infinite}
.core .cring::after{content:"";position:absolute;inset:2.5px;border-radius:50%;background:radial-gradient(circle, rgba(155,232,255,.95), rgba(34,211,238,.35) 70%, transparent)}
.core.a .cring{border-color:rgba(245,196,81,.6);box-shadow:0 0 10px rgba(245,196,81,.4), inset 0 0 5px rgba(245,196,81,.5)}
.core.a .cring::after{background:radial-gradient(circle, rgba(245,196,81,.95), rgba(245,196,81,.3) 70%, transparent)}
.core.r .cring{border-color:rgba(255,107,107,.65);box-shadow:0 0 11px rgba(255,107,107,.5), inset 0 0 5px rgba(255,107,107,.55);animation-duration:1.5s}
.core.r .cring::after{background:radial-gradient(circle, rgba(255,150,150,.95), rgba(255,107,107,.35) 70%, transparent)}
@media(max-width:980px){.core .ctxt{display:none}}
/* rail mark becomes a mini-reactor */
.rail .mk,.brand .mk{background:radial-gradient(circle at 50% 42%, rgba(155,232,255,.9), rgba(34,211,238,.45) 38%, rgba(10,18,34,.9) 75%);
  border:1px solid rgba(34,211,238,.5);box-shadow:0 0 18px var(--glow), inset 0 0 10px rgba(34,211,238,.55);
  animation:v3corebreath 4.6s ease-in-out infinite}

/* ── FLEET TOPOLOGY — the org as a living network ── */
.topo{margin:0 0 14px}
.topo svg{display:block;width:100%;height:auto}
.topo .edge{stroke:rgba(95,165,255,.18);stroke-width:1;fill:none}
.topo .flow{stroke:rgba(34,211,238,.55);stroke-width:1.2;fill:none;stroke-dasharray:3 14;stroke-linecap:round;
  animation:v3flow 2.8s linear infinite}
.topo .flow.a{stroke:rgba(245,196,81,.5)}.topo .flow.i{stroke:rgba(91,107,140,.45);animation-duration:5.5s}
@keyframes v3flow{to{stroke-dashoffset:-17}}
.topo .node circle{fill:#0B1322;stroke:rgba(95,165,255,.4);stroke-width:1.2}
.topo .node.g circle{stroke:rgba(52,224,161,.75);filter:drop-shadow(0 0 5px rgba(52,224,161,.55))}
.topo .node.a circle{stroke:rgba(245,196,81,.7);filter:drop-shadow(0 0 5px rgba(245,196,81,.5))}
.topo .node.r circle{stroke:rgba(255,107,107,.8);filter:drop-shadow(0 0 6px rgba(255,107,107,.6))}
.topo .node.i circle{stroke:rgba(91,107,140,.6)}
.topo .node.hub circle{animation:v3hub 3.6s ease-in-out infinite}
@keyframes v3hub{0%,100%{filter:drop-shadow(0 0 5px rgba(34,211,238,.4))}50%{filter:drop-shadow(0 0 13px rgba(34,211,238,.85))}}
/* COP — clickable common-operating-picture nodes (open the agent console). Exception-bright: a/r breathe. */
.topo .node{cursor:pointer}
.topo .node:hover circle{stroke-width:2.4}
.topo .node:focus{outline:none}
.topo .node:focus circle{stroke-width:2.6;stroke:var(--primaryH)}
.topo .node.a circle,.topo .node.r circle{animation:v3exc 2.8s ease-in-out infinite}
@keyframes v3exc{0%,100%{opacity:1}50%{opacity:.6}}
.topo text{fill:var(--dim);font:600 9.5px var(--mono);text-anchor:middle;letter-spacing:.4px}
.topo .node text.ic2{font-size:12px}
.topo .tlbl{fill:var(--faint);font:800 8.5px var(--mono);letter-spacing:1.6px;text-anchor:start}

/* ── BOOT SEQUENCE — once per session; skippable; honest statuses ── */
#boot{position:fixed;inset:0;z-index:200;display:grid;place-items:center;background:
  radial-gradient(700px 480px at 50% 40%, rgba(34,211,238,.07), transparent 60%), var(--v3-deep);
  cursor:pointer;animation:v3bootout .5s ease 3.4s forwards}
#boot.off{display:none}
@keyframes v3bootout{to{opacity:0;visibility:hidden;pointer-events:none}}
.bwrap{width:min(430px,86vw);font-family:var(--mono)}
.bcore{width:64px;height:64px;margin:0 auto 18px;border-radius:50%;position:relative;
  border:2px solid rgba(34,211,238,.5);box-shadow:0 0 32px rgba(34,211,238,.35), inset 0 0 18px rgba(34,211,238,.4);
  animation:v3corebreath 2.2s ease-in-out infinite}
.bcore::before{content:"";position:absolute;inset:-9px;border-radius:50%;border:1px dashed rgba(34,211,238,.4);border-top-color:rgba(155,232,255,.9);animation:v3corespin 3.2s linear infinite}
.bcore::after{content:"";position:absolute;inset:16px;border-radius:50%;background:radial-gradient(circle, rgba(155,232,255,.95), rgba(34,211,238,.3) 72%, transparent)}
.bttl{text-align:center;font-size:15px;font-weight:800;letter-spacing:7px;color:var(--v3-ice);text-shadow:0 0 22px rgba(34,211,238,.5);margin-bottom:4px}
.bsub{text-align:center;font-size:10px;letter-spacing:2.5px;color:var(--faint);margin-bottom:18px;animation:v3blink 1.2s step-end infinite}
@keyframes v3blink{50%{opacity:.35}}
.bline{display:flex;align-items:center;gap:9px;font-size:11.5px;color:var(--dim);padding:3px 0;opacity:0;transform:translateX(-7px);animation:v3bline .3s ease forwards}
.bline b{color:var(--txt);font-weight:600}
.bline .bok{color:var(--green)}.bline .bwarn{color:var(--amber)}.bline .boff{color:var(--idle)}
@keyframes v3bline{to{opacity:1;transform:none}}
.bready{margin-top:16px;text-align:center;font-size:12px;font-weight:800;letter-spacing:3px;color:var(--v3-ice);opacity:0;animation:v3bready .45s var(--spring) 2.55s forwards}
@keyframes v3bready{from{opacity:0;transform:scale(.92)}to{opacity:1;transform:scale(1)}}
.bskip{margin-top:9px;text-align:center;font-size:9.5px;letter-spacing:1.5px;color:var(--faint);opacity:0;animation:v3bline .4s ease 1.4s forwards}

/* ── staggered view reveal (deeper, springier than V2's rise) ── */
@media(prefers-reduced-motion:no-preference){
  .view:not([hidden])>*{animation:v3rise .42s var(--spring) both}
  .view:not([hidden])>*:nth-child(2){animation-delay:.04s}
  .view:not([hidden])>*:nth-child(3){animation-delay:.08s}
  .view:not([hidden])>*:nth-child(4){animation-delay:.12s}
  .view:not([hidden])>*:nth-child(5){animation-delay:.16s}
  .view:not([hidden])>*:nth-child(6){animation-delay:.2s}
  .view:not([hidden])>*:nth-child(7){animation-delay:.24s}
  .view:not([hidden])>*:nth-child(8){animation-delay:.28s}
  .view:not([hidden])>*:nth-child(n+9){animation-delay:.32s}
  @keyframes v3rise{from{opacity:0;transform:translateY(12px) scale(.992)}to{opacity:1;transform:none}}
  .drawer{transition:transform .4s var(--spring)}
  .kbar{transition:opacity .2s ease,transform .24s var(--spring)}
  .grid4 .card{animation:v3rise .5s var(--spring) both}
  .grid4 .card:nth-child(2){animation-delay:.06s}.grid4 .card:nth-child(3){animation-delay:.12s}.grid4 .card:nth-child(4){animation-delay:.18s}
}
/* focus ring, neon */
.cmd:focus-within{box-shadow:0 0 0 3px var(--glow), 0 0 24px rgba(34,211,238,.25)}

/* ═══════════ FLIGHT BRIDGE — the loop reports, you call GO ═══════════ */
/* Flight Loop Strip — the Exception Feed reframed as a flight-controller status call. */
.floop{border-left:3px solid var(--green)}
.floop.live{border-left-color:var(--amber)}
.floop-call{font-family:var(--mono);font-size:13.5px;font-weight:700;letter-spacing:.4px;margin:3px 0 4px}
.floop-sub{font-size:11px}
/* GO/NO-GO poll card — a NASA-style flight callout that demands one decisive call. */
.poll{border:1px solid var(--line);border-radius:11px;padding:11px 13px;margin-top:9px;
  background:rgba(8,11,20,.42);transition:border-color .25s ease, box-shadow .25s ease}
.poll:hover,.poll:focus-within{border-color:rgba(245,196,81,.5);box-shadow:0 0 0 1px rgba(245,196,81,.18)}
.poll-call{font-family:var(--mono);font-size:11px;letter-spacing:.4px;color:var(--amber);text-transform:uppercase}
.poll-flight{font-weight:800;letter-spacing:1px}
.poll-title{font-weight:700;margin:4px 0 7px;font-size:13px}
.poll-matrix{display:grid;grid-template-columns:1fr 1fr;gap:5px 16px;font-size:11.5px;color:var(--dim);margin-bottom:9px}
.poll-k{display:block;font-size:8.5px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);font-weight:800}
.pbtn.go{background:var(--sg);color:var(--green);border-color:rgba(52,224,161,.45);font-weight:800;padding:5px 18px;letter-spacing:1px}
.pbtn.nogo{background:var(--sr);color:var(--red);border-color:rgba(255,107,107,.35);font-weight:800;padding:5px 14px;letter-spacing:.5px}
.pbtn.go:hover{box-shadow:0 0 14px rgba(52,224,161,.4)}
/* GO-stamp — a teleprinter AUTHORIZE line that writes left-to-right on a successful call. */
.gostamp{display:inline-block;font-family:var(--mono);font-size:11px;letter-spacing:.5px;white-space:nowrap;
  overflow:hidden;max-width:360px;animation:v3type .5s steps(30,end) both}
.gostamp.ok{color:var(--green)}
.gostamp.no{color:var(--red)}
@keyframes v3type{from{max-width:0}to{max-width:360px}}
/* core ring-flare — the kernel acknowledges an authorization (one-shot). */
.core .cring.flare{animation:v3flare .65s ease}
@keyframes v3flare{0%{box-shadow:0 0 10px rgba(34,211,238,.45), inset 0 0 5px rgba(34,211,238,.5)}
  35%{box-shadow:0 0 26px var(--v3-core), 0 0 46px rgba(34,211,238,.7), inset 0 0 7px rgba(155,232,255,.9)}
  100%{box-shadow:0 0 10px rgba(34,211,238,.45), inset 0 0 5px rgba(34,211,238,.5)}}
/* fleet cards read as dark consoles in the grid */
.grid4 .card{background:linear-gradient(180deg, rgba(56,189,248,.05), transparent 42%), rgba(6,9,16,.55)}
@media(max-width:760px){.poll-matrix{grid-template-columns:1fr}}

/* ── performance + accessibility floors ── */
@media(max-width:760px){
  body::after{animation:none}
  .v3beam{display:none}
  .card::after,.htile.lead::after{display:none}
  .sysv::after{animation:none}
}
@media(prefers-reduced-motion:reduce){
  body::after,.v3beam,.sysv::before,.sysv::after,.core .cring,.rail .mk,.brand .mk,.dot.g,.dot.a,
  .topo .flow,.topo .node.hub circle,.topo .node.a circle,.topo .node.r circle,
  .gostamp,.core .cring.flare{animation:none !important}
  .gostamp{max-width:none !important}
  #boot{display:none}
  .card,.card:hover{transform:none}
}
`;

// ─── 2. Boot sequence (honest, per-session, skippable) ────────────────────────

export interface BootLine {
  label: string;
  status: "live" | "partial" | "unavailable" | string;
}

/**
 * The startup overlay. Server-rendered from the REAL registry statuses (live → Online,
 * partial → Partial, else Offline) — the boot screen never claims an agent is up when it isn't.
 * Pure CSS auto-dismisses it (works without JS); the client script also removes it instantly on
 * later loads in the same session (sessionStorage) and on click/keypress (skippable).
 */
export function bootOverlayHtml(lines: BootLine[]): string {
  const rows = lines
    .slice(0, 8)
    .map((l, i) => {
      const glyph = l.status === "live" ? `<span class="bok">✓</span>` : l.status === "partial" ? `<span class="bwarn">△</span>` : `<span class="boff">○</span>`;
      const word = l.status === "live" ? "Online" : l.status === "partial" ? "Partial" : "Offline";
      // Stagger delay is server-rendered per line (nth-child can't index .bline among its siblings).
      return `<div class="bline" style="animation-delay:${(0.45 + i * 0.24).toFixed(2)}s">${glyph}<b>${esc(l.label)}</b><span style="margin-left:auto">${esc(word)}</span></div>`;
    })
    .join("");
  return (
    `<div id="boot" role="presentation" aria-hidden="true"><div class="bwrap">` +
    `<div class="bcore"></div>` +
    `<div class="bttl">HARTOS</div>` +
    `<div class="bsub">INITIALIZING COMMAND BRIDGE…</div>` +
    rows +
    `<div class="bready">FLEET READY</div>` +
    `<div class="bskip">CLICK TO SKIP</div>` +
    `</div></div>`
  );
}

// ─── 3. The HARTOS CORE chip (topbar heartbeat) ───────────────────────────────

export function coreStatusHtml(tone: "g" | "a" | "r" | "i", overall: string): string {
  const word = tone === "g" ? "ONLINE" : tone === "a" ? "DEGRADED" : tone === "r" ? "ALERT" : "STANDBY";
  return (
    `<span class="core ${tone}" title="HartOS Core — ${esc(overall)}">` +
    `<i class="cring" aria-hidden="true"></i><span class="ctxt">HARTOS CORE · ${word}</span></span>`
  );
}

// ─── 4. Fleet topology — the org chart as a living network ────────────────────

function nodeTone(a: MetaAgent): "g" | "a" | "r" | "i" {
  if (a.status === "live") return "g";
  if (a.status === "partial") return "a";
  if (a.status === "unavailable") return "i";
  return "i";
}

const TOPO_ICON: Record<string, string> = {
  hart: "◉", orchestrator: "◆", fitness: "🏃", ops: "📋", factory: "🏭", research: "🔬",
  beezulbub: "🐝", wolverine: "🦴", prophet: "👁", rinnegan: "🌀", "executive-memory": "🧠",
  "execution-engine": "⚙", officiator: "⚖", simulator: "🎛",
};

/**
 * Render the fleet as an SVG network: Hart → Orchestrator → reporting agents (with sub-reports
 * one level deeper). Coordinates are computed server-side from the registry's real reportsTo
 * edges; node tone = the agent's honest status. Edges carry an animated data-flow dash (CSS).
 */
export function fleetTopologyHtml(reg: MetaAgentRegistry): string {
  const hub = reg.agents.find((a) => a.id === "orchestrator") ?? null;
  const root = reg.byId[reg.rootId] ?? null;
  if (!hub || !root) return "";
  const tier = reg.agents.filter((a) => a.reportsTo === hub.id);
  const W = 860;
  // The tier wraps to two rows past 7 nodes — 13 single-row labels collide at this width.
  const perRow = tier.length > 7 ? Math.ceil(tier.length / 2) : tier.length;
  const rows: MetaAgent[][] = perRow > 0 ? [tier.slice(0, perRow), tier.slice(perRow)].filter((r) => r.length > 0) : [];
  const Y_ROOT = 30, Y_HUB = 96, Y_TIER = 180, ROW_GAP = 72;
  const lastTierY = Y_TIER + (rows.length - 1) * ROW_GAP;

  const pos = new Map<string, { x: number; y: number }>();
  pos.set(root.id, { x: W / 2, y: Y_ROOT });
  pos.set(hub.id, { x: W / 2, y: Y_HUB });
  rows.forEach((row, r) => {
    const gap = Math.min(116, (W - 80) / Math.max(row.length, 1));
    const x0 = (W - gap * (row.length - 1)) / 2;
    row.forEach((a, i) => pos.set(a.id, { x: x0 + i * gap, y: Y_TIER + r * ROW_GAP }));
  });
  // one sub-level (e.g. officiator/simulator under factory), spread under their parent
  const subs = reg.agents.filter((a) => a.reportsTo && pos.has(a.reportsTo) && !pos.has(a.id) && a.reportsTo !== root.id);
  const Y_SUB = lastTierY + 68;
  const byParent = new Map<string, MetaAgent[]>();
  for (const s of subs) {
    const list = byParent.get(s.reportsTo!) ?? [];
    list.push(s);
    byParent.set(s.reportsTo!, list);
  }
  for (const [pid, kids] of byParent) {
    const p = pos.get(pid)!;
    kids.forEach((k, i) => pos.set(k.id, { x: p.x + (i - (kids.length - 1) / 2) * 76, y: Y_SUB }));
  }
  const H = (subs.length > 0 ? Y_SUB : lastTierY) + 42;

  const edge = (a: { x: number; y: number }, b: { x: number; y: number }, tone: string): string => {
    const my = (a.y + b.y) / 2;
    const d = `M${a.x},${a.y + 14} C${a.x},${my} ${b.x},${my} ${b.x},${b.y - 14}`;
    return `<path class="edge" d="${d}"/><path class="flow ${tone}" d="${d}"/>`;
  };
  let edges = edge(pos.get(root.id)!, pos.get(hub.id)!, "g");
  for (const a of [...tier, ...subs]) {
    const p = pos.get(a.reportsTo!)!;
    const c = pos.get(a.id)!;
    const t = nodeTone(a);
    edges += edge(p, c, t === "g" ? "g" : t === "a" ? "a" : "i");
  }

  const nodeHtml = (a: MetaAgent, hubNode: boolean): string => {
    const p = pos.get(a.id)!;
    const t = nodeTone(a);
    const icon = TOPO_ICON[a.id] ?? "●";
    const label = a.displayName.length > 16 ? `${a.id}` : a.displayName.replace(/ \(.*\)$/, "").replace(/ \/.*$/, "");
    return (
      `<g class="node ${t}${hubNode ? " hub" : ""}" data-agent="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.displayName)} — ${esc(a.status)}; open console">` +
      `<title>${esc(a.displayName)} · ${esc(a.status)} — open console</title>` +
      `<circle cx="${p.x}" cy="${p.y}" r="${hubNode ? 15 : 12}"/>` +
      `<text class="ic2" x="${p.x}" y="${p.y + 4}">${icon}</text>` +
      `<text x="${p.x}" y="${p.y + (hubNode ? 30 : 26)}">${esc(label)}</text>` +
      `</g>`
    );
  };
  const nodes =
    nodeHtml(root, false) +
    nodeHtml(hub, true) +
    tier.map((a) => nodeHtml(a, false)).join("") +
    subs.map((a) => nodeHtml(a, false)).join("");

  return (
    `<div class="box topo"><div class="blbl">Fleet Network · live topology</div>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="HartOS fleet topology — ${reg.agents.length} nodes">` +
    `<text class="tlbl" x="14" y="16">COMMAND CHAIN</text>` +
    edges +
    nodes +
    `</svg>` +
    `<div class="muted" style="font-size:10.5px">Real org edges from the meta-agent registry — green live · amber partial · grey idle. Click a node to open its console. Data flow is decorative; statuses are not.</div>` +
    `</div>`
  );
}

// ─── 5. The V3 client script (progressive enhancement only) ───────────────────

/**
 * Boot dismissal (session-once + click/key skip), one-shot number count-ups, and view-switch
 * stagger re-trigger. Self-contained IIFE; touches NOTHING the existing script owns; every
 * feature no-ops cleanly when its element is absent or reduced-motion is set. Includes the
 * window.HARTOS_SFX seam (no audio is loaded or played — design-for-sound only).
 */
export function v3ClientScript(): string {
  return `<script>
(function(){
  var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // sound-design seam: future tones hook here; deliberately a no-op today.
  window.HARTOS_SFX=window.HARTOS_SFX||function(){};
  var boot=document.getElementById('boot');
  if(boot){
    var seen=false;
    try{seen=!!sessionStorage.getItem('hartosBoot');sessionStorage.setItem('hartosBoot','1');}catch(e){}
    if(seen||rm){boot.classList.add('off');}
    else{
      var kill=function(){boot.classList.add('off');window.HARTOS_SFX('boot');};
      boot.addEventListener('click',kill);
      document.addEventListener('keydown',function h(e){kill();document.removeEventListener('keydown',h);});
      setTimeout(kill,4000);
    }
  }
  if(rm){return;}
  // one-shot count-up on the big numeric readouts (server text is the source of truth; we only
  // animate toward it, then restore the exact original string).
  function countUp(el){
    var txt=el.textContent||'';var m=txt.match(/^(\\d+(?:\\.\\d+)?)/);if(!m){return;}
    var target=parseFloat(m[1]);if(!isFinite(target)||target<=0){return;}
    var dec=(m[1].split('.')[1]||'').length,rest=txt.slice(m[1].length),t0=null,DUR=700;
    function step(ts){
      if(t0===null){t0=ts;}
      var p=Math.min(1,(ts-t0)/DUR);p=1-Math.pow(1-p,3);
      el.textContent=(target*p).toFixed(dec)+rest;
      if(p<1){requestAnimationFrame(step);}else{el.textContent=txt;}
    }
    requestAnimationFrame(step);
  }
  Array.prototype.forEach.call(document.querySelectorAll('.htile .big, .facts b'),countUp);
  // re-trigger the stagger when the rail/bottom-nav switches views (class flip restarts CSS anim)
  Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'),function(n){
    n.addEventListener('click',function(){
      window.HARTOS_SFX('nav');
      var v=document.querySelector('.view:not([hidden])');
      if(!v){return;}
      Array.prototype.forEach.call(v.children,function(c){
        c.style.animation='none';void c.offsetWidth;c.style.animation='';
      });
    });
  });
})();
</script>`;
}

/**
 * FLIGHT BRIDGE hotkeys + authorization acknowledgement. Additive IIFE — no new globals beyond the
 * documented window.hartosFlightAck hook the page's existing transition delegate calls on a
 * successful GO/NO-GO. Pressing 'g'/'n' on a focused (or the first pending) poll card synthesizes a
 * click on its GO/NO-GO button (so it reuses the SAME gated /api/proposals/transition path — never a
 * new write). On a successful call the kernel CORE flares once and the Flight Loop Strip recounts
 * client-side, settling to a calm "all clear" when the board is empty. Guarded so it never fires while
 * typing or during ⌘K, and snaps to no-motion under prefers-reduced-motion. No-ops when its elements
 * are absent (so login/locked/detail pages are unaffected).
 */
export function flightHotkeysScript(): string {
  return `<script>
(function(){
  var rm=window.matchMedia&&window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  // The page's transition delegate calls this on a confirmed GO/NO-GO (ok=true).
  window.hartosFlightAck=function(act,ok){
    if(!ok){return;}
    var core=document.querySelector('.core .cring');
    if(core&&!rm){core.classList.remove('flare');void core.offsetWidth;core.classList.add('flare');setTimeout(function(){core.classList.remove('flare');},700);}
    var remaining=0;
    Array.prototype.forEach.call(document.querySelectorAll('.floop .pact'),function(w){if(w.querySelector('.pbtn')){remaining++;}});
    var c=document.getElementById('floop-count');if(c){c.textContent=String(remaining);}
    if(remaining===0){
      var call=document.querySelector('.floop .floop-call');
      if(call){call.innerHTML='<span style="color:var(--green)">\\u2713 LOOP NOMINAL \\u00b7 all clear \\u2014 the board is quiet</span>';}
      var sec=document.querySelector('.floop');if(sec){sec.classList.remove('live');}
    }
    if(window.HARTOS_SFX){window.HARTOS_SFX('authorize');}
  };
  // g = GO, n = NO-GO — clear the board from the keyboard like a Flight Director.
  document.addEventListener('keydown',function(e){
    if(e.metaKey||e.ctrlKey||e.altKey){return;}
    var t=document.activeElement,tag=t&&t.tagName;
    if(tag==='INPUT'||tag==='TEXTAREA'||(t&&t.isContentEditable)){return;}
    var k=e.key&&e.key.toLowerCase();
    if(k!=='g'&&k!=='n'){return;}
    var poll=(t&&t.closest)?t.closest('.poll'):null;
    if(!poll){var b=document.querySelector('.floop .poll .pact .pbtn');poll=b?b.closest('.poll'):null;}
    if(!poll){return;}
    var btn=poll.querySelector(k==='g'?'.pbtn.ok':'.pbtn.no');
    if(btn&&!btn.disabled){e.preventDefault();btn.click();}
  });
})();
</script>`;
}
