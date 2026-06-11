/**
 * src/runtime/views/cockpit-synapse.ts — Cockpit V4 "SYNAPSE": the neural-constellation command home.
 *
 * The cockpit's organizing surface is a living star-map of the fleet: the Orchestrator is the bright
 * central star (the kernel), the meta-agents are stars in formation around it (toned by their honest
 * status), the synapses (edges) FIRE only on agents that are actually reporting (live) — never
 * decorative — and the DECISIONS that need Hart are the brightest, pulsing nodes you can't miss.
 * Click a decision-node → its GO/NO-GO panel focuses; click an agent-star → its console drawer.
 *
 * Pure string builders, ZERO dependencies, fully self-contained (no CDN/fonts/images; inline SVG +
 * CSS + a small additive <script>). NODE-safe — no fs/clock (positions are deterministic from the
 * registry). It reuses the existing JS contract verbatim: agent stars carry `.node[data-agent]`
 * (the existing drawer handler fires for free); decision GO/NO-GO buttons keep `.pact[data-pid]` +
 * `.pbtn[data-act]` (the existing gated transition delegate fires); the verdict reuses coreStatusHtml.
 */

import type { MetaAgentRegistry, MetaAgent } from "../../agents/meta-agent-registry.js";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// ─── A decision node (the bright, pulsing, clickable stars) ───────────────────
export interface SynapseDecision {
  pid: string;
  title: string;
  domain: string;
}

function nodeTone(a: MetaAgent): "g" | "a" | "i" {
  if (a.status === "live") return "g";
  if (a.status === "partial") return "a";
  return "i";
}

const STAR_ICON: Record<string, string> = {
  orchestrator: "◆", fitness: "🏃", ops: "📋", factory: "🏭", research: "🔬", prophet: "👁",
  rinnegan: "🌀", beezulbub: "🐝", wolverine: "🦴", "executive-memory": "🧠",
  officiator: "⚖", simulator: "🎛", "execution-engine": "⚙",
};

// ─── 1. Style ─────────────────────────────────────────────────────────────────
export const SYNAPSE_STYLE = `
/* ═══════════ COCKPIT V4 · SYNAPSE — neural-constellation command home ═══════════ */
.syn-wrap{position:relative}
.syn-hero{display:grid;grid-template-columns:1.55fr 1fr;gap:18px;align-items:stretch}
@media(max-width:1100px){.syn-hero{grid-template-columns:1fr}}
/* the constellation field */
.syn-field{position:relative;border:1px solid var(--line);border-radius:16px;overflow:hidden;min-height:480px;
  background:
    radial-gradient(120% 90% at 50% 40%, rgba(34,211,238,.06), transparent 60%),
    radial-gradient(circle at 50% 42%, rgba(10,16,30,.7), rgba(4,6,12,.92) 78%);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.04), 0 20px 60px rgba(0,0,0,.5)}
.syn-field svg{display:block;width:100%;height:auto}
.syn-tt{position:absolute;left:14px;top:13px;font:800 9px var(--mono);letter-spacing:1.8px;color:var(--faint);text-transform:uppercase}
.syn-cap{position:absolute;left:14px;bottom:11px;right:14px;font:11px var(--mono);color:var(--faint);letter-spacing:.3px}
/* synapse edges */
.syn-edge{stroke:rgba(95,165,255,.13);stroke-width:1;fill:none}
.syn-fire{stroke:rgba(34,211,238,.5);stroke-width:1.3;fill:none;stroke-dasharray:2 13;stroke-linecap:round;animation:synflow 2.6s linear infinite}
@keyframes synflow{to{stroke-dashoffset:-15}}
/* agent stars */
.star{cursor:pointer}
.star circle.body{fill:#0a1322;stroke:rgba(95,165,255,.4);stroke-width:1.2;transition:r .25s,filter .25s}
.star.g circle.body{stroke:rgba(52,224,161,.8);filter:drop-shadow(0 0 5px rgba(52,224,161,.6))}
.star.a circle.body{stroke:rgba(245,196,81,.75);filter:drop-shadow(0 0 5px rgba(245,196,81,.55))}
.star.i circle.body{stroke:rgba(91,107,140,.6)}
.star:hover circle.body,.star:focus circle.body{r:13;filter:drop-shadow(0 0 12px var(--glow))}
.star text{fill:var(--dim);font:600 9.5px var(--mono);text-anchor:middle;letter-spacing:.3px;pointer-events:none}
.star text.ic{font-size:12px}
.star .halo{fill:none;stroke-width:1;opacity:.5}
.star.g .halo{stroke:rgba(52,224,161,.3);animation:synbreath 4s ease-in-out infinite}
.star.a .halo{stroke:rgba(245,196,81,.32);animation:synbreath 2.6s ease-in-out infinite}
@keyframes synbreath{0%,100%{opacity:.25;r:14}50%{opacity:.6}}
/* the core star (orchestrator / kernel) */
.core-star circle.k{fill:url(#coreGrad);stroke:rgba(166,236,255,.7);stroke-width:1.5;animation:corepulse 4.6s ease-in-out infinite}
.core-star circle.kr{fill:none;stroke:rgba(40,214,240,.35);stroke-dasharray:3 9;animation:synspin 16s linear infinite}
@keyframes synspin{to{transform:rotate(360deg);transform-origin:center}}
@keyframes corepulse{0%,100%{filter:drop-shadow(0 0 8px rgba(40,214,240,.5))}50%{filter:drop-shadow(0 0 22px rgba(40,214,240,.95))}}
.core-star text{fill:var(--ice,#A6ECFF);font:800 10px var(--mono);text-anchor:middle;letter-spacing:1px}
/* DECISION nodes — the brightest, pulsing, you-can't-miss stars */
.dnode{cursor:pointer}
.dnode circle.d{fill:#1a1206;stroke:var(--amber);stroke-width:1.6;filter:drop-shadow(0 0 9px rgba(245,196,81,.7));animation:dpulse 1.9s ease-in-out infinite}
.dnode circle.dr{fill:none;stroke:rgba(245,196,81,.5);animation:dring 1.9s ease-in-out infinite}
@keyframes dpulse{0%,100%{filter:drop-shadow(0 0 8px rgba(245,196,81,.55))}50%{filter:drop-shadow(0 0 18px rgba(245,196,81,1))}}
@keyframes dring{0%{r:9;opacity:.7}100%{r:22;opacity:0}}
.dnode text{fill:var(--amber);font:800 9px var(--mono);text-anchor:middle;letter-spacing:.4px;pointer-events:none}
.dnode.flash circle.d{animation:dflash .7s ease}
@keyframes dflash{0%,100%{filter:drop-shadow(0 0 9px rgba(245,196,81,.7))}40%{filter:drop-shadow(0 0 30px rgba(255,255,255,.95))}}
/* verdict hero */
.syn-verdict{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap;margin:2px 0 14px}
/* tone suffixes are syn-prefixed so they never collide with the V2 utility .g/.a/.r{background:...} */
.syn-vbig{font-size:34px;font-weight:800;letter-spacing:-.5px;background:none!important}
.syn-vbig.syn-g{color:var(--green);text-shadow:0 0 26px rgba(52,224,161,.3)}
.syn-vbig.syn-a{color:var(--amber);text-shadow:0 0 26px rgba(245,196,81,.28)}
.syn-vbig.syn-r{color:var(--red);text-shadow:0 0 26px rgba(255,107,107,.3)}
.syn-vbig.syn-i{color:var(--idle)}
.syn-vline{font-family:var(--mono);font-size:13px;color:var(--dim)}.syn-vline b{color:var(--txt)}
/* decision column (always-visible GO/NO-GO — decisions are primary) */
.syn-decs{display:flex;flex-direction:column;gap:11px}
.syn-decs .seclbl{margin-top:0}
.dec{border:1px solid var(--line);border-radius:14px;padding:14px 16px;background:var(--panel);-webkit-backdrop-filter:var(--glass);backdrop-filter:var(--glass);transition:box-shadow .3s,border-color .3s,transform .3s}
.dec:hover{border-color:rgba(245,196,81,.4);transform:translateY(-2px)}
.dec.flash{box-shadow:0 0 0 2px rgba(245,196,81,.6),0 0 34px rgba(245,196,81,.25)}
.dec .dcall{font-family:var(--mono);font-size:10.5px;letter-spacing:.5px;color:var(--amber);text-transform:uppercase}
.dec .dttl{font-weight:700;font-size:14px;margin:5px 0 9px}
.dec .dwhy{font-size:12px;color:var(--dim);margin-bottom:11px}.dec .dwhy b{color:var(--txt)}
.dec .pbtn.go{background:var(--sg);color:var(--green);border:1px solid rgba(52,224,161,.45);font-weight:800;letter-spacing:1px;border-radius:9px;padding:8px 20px;cursor:pointer;font:inherit;font-weight:800}
.dec .pbtn.nogo{background:var(--sr);color:var(--red);border:1px solid rgba(255,107,107,.35);font-weight:800;letter-spacing:.5px;border-radius:9px;padding:8px 16px;cursor:pointer;font:inherit}
.dec .pbtn.go:hover{box-shadow:0 0 16px rgba(52,224,161,.4)}
.syn-empty{border:1px solid var(--line2);border-left:3px solid var(--green);border-radius:12px;padding:16px;color:var(--green);font-family:var(--mono);font-size:13px;background:rgba(52,224,161,.04)}
/* handled + opportunities lanes */
.syn-lanes{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:18px}
@media(max-width:1100px){.syn-lanes{grid-template-columns:1fr}}
/* ── mobile: keep it simple (V3-style reflow) — a clean stacked briefing; the constellation is a
   desktop centerpiece and drops out on the phone, where the verdict + decisions + status strip carry
   it. Reuses the shared shell's bottom-nav (rail hides < 760px). No separate render — just reflow. ── */
@media(max-width:760px){
  /* shell: the off-canvas drawer (translateX 100%) would extend scrollWidth; clip horizontal
     scroll so the phone never pans sideways (the fixed drawer still slides in over the viewport). */
  html,body{overflow-x:hidden}
  /* topbar wraps so the Ask bar takes the full row and the status pills drop below it,
     instead of the pills being pushed off the right edge. */
  .tb{flex-wrap:wrap}
  .cmd{max-width:none;flex:1 1 100%;flex-wrap:wrap}
  /* the opt-in privacy note flows onto its own compact line under the input instead of
     squeezing into a tall narrow column beside it (stays visible for the listening state). */
  #voice-status{flex-basis:100%;font-size:11px;line-height:1.35;margin-top:3px}
  .syn-field{display:none}
  .syn-hero{grid-template-columns:1fr;gap:0}
  .syn-lanes{grid-template-columns:1fr;gap:12px}
  .syn-verdict{margin:4px 0 14px;gap:8px}
  .syn-vbig{font-size:30px}
  .syn-vline{font-size:12px}
  .syn-decs .seclbl{margin-top:2px}
  .dec{border-radius:16px;padding:15px 16px}
  .dec .dttl{font-size:15px}
  .dec .pact{display:flex;gap:10px;margin-top:6px}
  .dec .pbtn.go,.dec .pbtn.nogo{flex:1;padding:13px 0;font-size:14.5px;border-radius:12px}
}
@media(prefers-reduced-motion:reduce){.syn-fire,.star .halo,.core-star circle.k,.core-star circle.kr,.dnode circle.d,.dnode circle.dr,.dnode.flash circle.d{animation:none!important}}
`;

// ─── 2. The constellation SVG ─────────────────────────────────────────────────
/**
 * Render the neural constellation from the REAL registry. Orchestrator = central star; the other
 * meta-agents orbit on a ring, toned by honest status; synapses fire (animate) ONLY to live agents
 * (a quiet/partial fleet is visually still — diegetic, no fake motion). Decision nodes are placed on
 * an inner arc as the brightest pulsing stars, each clickable to focus its GO/NO-GO panel.
 */
export function synapseConstellation(reg: MetaAgentRegistry, decisions: SynapseDecision[]): string {
  const W = 960, H = 540, cx = W / 2, cy = H / 2 + 8;
  const orch = reg.byId["orchestrator"];
  const orbit = reg.agents.filter((a) => a.id !== "hart" && a.id !== "orchestrator");
  const n = Math.max(orbit.length, 1);
  const R = 196;

  const edges: string[] = [];
  const stars: string[] = [];
  orbit.forEach((a, i) => {
    const ang = (i / n) * Math.PI * 2 - Math.PI / 2;
    const jitter = (i % 3) * 16; // organic depth
    const x = cx + Math.cos(ang) * (R - jitter);
    const y = cy + Math.sin(ang) * (R - jitter) * 0.82; // slightly elliptical field
    const t = nodeTone(a);
    const fires = a.status === "live"; // synapse fires only on a reporting agent
    edges.push(`<path class="${fires ? "syn-fire" : "syn-edge"}" d="M${cx},${cy} Q${(cx + x) / 2 + (i % 2 ? 18 : -18)},${(cy + y) / 2} ${x.toFixed(0)},${y.toFixed(0)}"/>`);
    const label = a.displayName.replace(/ \(.*\)$/, "").replace(/ \/.*$/, "");
    stars.push(
      // class includes `node` so the page's EXISTING .node[data-agent] click/Enter delegate opens
      // the agent console drawer for free — no new agent-open wiring needed.
      `<g class="node star ${t}" data-agent="${esc(a.id)}" role="button" tabindex="0" aria-label="${esc(a.displayName)} — ${esc(a.status)}">` +
      `<circle class="halo" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="14"/>` +
      `<circle class="body" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="10"/>` +
      `<text class="ic" x="${x.toFixed(0)}" y="${(y + 4).toFixed(0)}">${STAR_ICON[a.id] ?? "●"}</text>` +
      `<text x="${x.toFixed(0)}" y="${(y + 25).toFixed(0)}">${esc(label)}</text>` +
      `</g>`,
    );
  });

  // decision nodes — brightest stars on an inner arc, can't be missed
  const dnodes = decisions.slice(0, 4).map((d, i) => {
    const dn = decisions.slice(0, 4).length;
    const ang = (i / dn) * Math.PI * 2 - Math.PI / 2 + Math.PI / dn;
    const r = 96;
    const x = cx + Math.cos(ang) * r, y = cy + Math.sin(ang) * r * 0.82;
    return (
      `<g class="dnode" data-dec="${esc(d.pid)}" role="button" tabindex="0" aria-label="Decision: ${esc(d.title)}">` +
      `<circle class="dr" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="9"/>` +
      `<circle class="d" cx="${x.toFixed(0)}" cy="${y.toFixed(0)}" r="7"/>` +
      `<text x="${x.toFixed(0)}" y="${(y - 13).toFixed(0)}">GO?</text>` +
      `</g>`
    );
  }).join("");

  const core =
    `<g class="core-star">` +
    `<circle class="kr" cx="${cx}" cy="${cy}" r="30"/>` +
    `<circle class="k" cx="${cx}" cy="${cy}" r="17"/>` +
    `<text x="${cx}" y="${cy + 4}">CORE</text>` +
    `<text x="${cx}" y="${cy + 44}" style="font-size:8.5px;fill:var(--faint);letter-spacing:1.4px">${esc((orch?.displayName ?? "ORCHESTRATOR").toUpperCase().slice(0, 22))}</text>` +
    `</g>`;

  return (
    `<div class="syn-field">` +
    `<div class="syn-tt">FLEET CONSTELLATION · LIVE</div>` +
    `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="HartOS fleet constellation — ${reg.agents.length} agents">` +
    `<defs><radialGradient id="coreGrad" cx="50%" cy="42%" r="60%"><stop offset="0%" stop-color="#CFF6FF"/><stop offset="40%" stop-color="#28D6F0"/><stop offset="100%" stop-color="#0a2733"/></radialGradient></defs>` +
    edges.join("") + core + stars.join("") + dnodes +
    `</svg>` +
    `<div class="syn-cap">Real registry · stars toned by honest status (green live · amber partial · dim idle) · synapses fire only on reporting agents · amber nodes need your GO.</div>` +
    `</div>`
  );
}

// ─── 3. Client script (additive; reuses the existing drawer + transition delegates) ──
/**
 * Decision-node → focus its GO/NO-GO panel (scroll + flash). Agent stars carry `.node[data-agent]`,
 * so the page's EXISTING drawer click/Enter delegate opens their console — nothing added here for
 * stars. This only wires the decision-node → panel focus. No new globals; no-ops when absent.
 */
export function synapseClientScript(): string {
  return `<script>
(function(){
  function focusDec(pid){ var el=document.getElementById('dec-'+pid); if(!el){return;} el.scrollIntoView({behavior:'smooth',block:'center'}); el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); setTimeout(function(){el.classList.remove('flash');},1400); }
  document.addEventListener('click',function(e){
    var d=e.target.closest&&e.target.closest('.dnode[data-dec]'); if(d){focusDec(d.getAttribute('data-dec'));}
  });
  document.addEventListener('keydown',function(e){
    if(e.key!=='Enter'&&e.key!==' ')return;var a=document.activeElement;
    if(a&&a.classList&&a.classList.contains('dnode')&&a.getAttribute('data-dec')){e.preventDefault();focusDec(a.getAttribute('data-dec'));}
  });
})();
</script>`;
}
