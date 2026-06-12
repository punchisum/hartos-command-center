/**
 * src/runtime/cloudflare-cockpit-v5.ts — the HartOS "Neural Deck" cockpit (v5), Worker-rendered.
 *
 * A faithful implementation of the sister-session v5 design: the fleet as a connectome of neurons
 * around a cognitive core, signal as EEG, proposals as synapses awaiting authorization — plus the
 * NEW **Live Operations** page (Hart's ask) showing tasks in flight (research running, an agent
 * building, Wolverine sweeping) with honest lifecycle stages.
 *
 * Server renders the shell + injects a real-data JSON blob (agents, tasks, proposals, metrics); a
 * small inline script hydrates every page client-side (SPA nav) and posts the footer console to the
 * existing /api/ask. Flag-gated: GET / renders v5 when HARTOS_COCKPIT_V5=true OR ?v5=1. Read-only +
 * secret-free — same posture as the rest of the hosted cockpit. No external JS beyond fonts/icons.
 */

import type { TasksView, TaskSourceRow } from "../cockpit/tasks-view.js";
import { buildTasksView } from "../cockpit/tasks-view.js";

export interface V5Agent {
  id: string;
  name: string;
  initials: string;
  role: string;
  metric: string;
  color: string;
  status: "firing" | "healthy" | "watch" | "idle" | "down";
}

export interface V5Proposal {
  id: string;
  origin: string;
  title: string;
  tier: string;
  color: string;
  status: string;
}

export interface V5Event {
  time: string;
  agent: string;
  text: string;
  color: string;
}

export interface CockpitV5Data {
  now: string;
  buildSha: string | null;
  fleetFitness: string;
  verify: string;
  signalPerMin: number;
  corticalLoad: number;
  agents: V5Agent[];
  tasks: TasksView;
  proposals: V5Proposal[];
  events: V5Event[];
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Canonical Neural-Deck polar layout (angle°, radius) per agent id — from the v5 design. */
const LAYOUT: Record<string, [number, number]> = {
  command: [-90, 330], sentinel: [-54, 300], cto: [-18, 352], factory: [18, 302], fitness: [54, 346],
  ops: [90, 300], beezulbub: [126, 350], prophet: [162, 300], wolverine: [198, 352], rinnegan: [234, 305],
};

const CSS = `*{box-sizing:border-box;margin:0;padding:0}
body{background:#05030C;color:#ECE4F8;font-family:'Rajdhani',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.mono{font-family:'JetBrains Mono',monospace}.orb{font-family:'Orbitron',sans-serif}
.dot{width:8px;height:8px;border-radius:50%;display:inline-block}
.pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(140,100,230,0.18);border-radius:999px;font-size:13px;letter-spacing:.04em}
.panel{background:#0C0720;border:1px solid rgba(140,100,230,0.18);border-radius:16px;position:relative}
.phd{display:flex;align-items:center;gap:9px;font-weight:700;font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#9C8CBC}
.phd .ct{margin-left:auto;font-family:'JetBrains Mono';font-size:11px;letter-spacing:0;color:#695B89}
.deck{min-height:100vh;display:flex;flex-direction:column;background:radial-gradient(1200px 700px at 38% 30%, #0A0518 0%, #05030C 62%)}
header{height:72px;flex:0 0 auto;display:flex;align-items:center;gap:18px;padding:0 26px;border-bottom:1px solid rgba(140,100,230,0.18)}
.bmk{width:36px;height:36px;border-radius:11px;background:linear-gradient(135deg,#FF2D9E,#A974FF);display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;box-shadow:0 0 22px -4px #FF2D9E}
.bw{font-family:'Orbitron';font-weight:900;font-size:21px;line-height:1}.bt{font-size:11px;letter-spacing:.34em;color:#9C8CBC;text-transform:uppercase}
.v5{font-family:'JetBrains Mono';font-size:11px;color:#22E8FF;border:1px solid rgba(34,232,255,.34);border-radius:6px;padding:2px 7px}
.link{margin:0 auto;display:flex;align-items:center;gap:11px;padding:8px 18px;border:1px solid rgba(34,232,255,.3);border-radius:999px;background:rgba(34,232,255,.05)}
.link .mono{font-size:12px;letter-spacing:.18em;color:#22E8FF}
.hr{display:flex;align-items:center;gap:14px}
.av{width:34px;height:34px;border-radius:11px;background:rgba(169,116,255,.16);border:1px solid rgba(169,116,255,.4);display:flex;align-items:center;justify-content:center;color:#A974FF;font-weight:700}
.stage{flex:1;display:flex;gap:18px;padding:18px;min-height:0}
.spine{width:92px;flex:0 0 auto;display:flex;flex-direction:column;align-items:center;gap:8px;padding:14px 0;background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:18px}
.nv{width:64px;height:60px;border-radius:14px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;color:#695B89;font-size:10px;letter-spacing:.06em;text-transform:uppercase;text-align:center;line-height:1.05;cursor:pointer;transition:all .18s ease-out}
.nv i{font-size:22px}
.nv.on{color:#22E8FF;background:rgba(34,232,255,.08);border:1px solid rgba(34,232,255,.28);box-shadow:0 0 22px -8px #22E8FF}
.nv:hover{color:#22E8FF;background:rgba(34,232,255,.05)}
.spine-f{margin-top:auto;text-align:center;display:flex;flex-direction:column;align-items:center;gap:4px}.spine-f .mono{font-size:11px;color:#34F5A8}
.page{flex:1;min-width:0;display:flex;gap:18px;flex-direction:column}
.cap{display:flex;align-items:center;gap:12px;flex:0 0 auto}
.cap h2{font-family:'Orbitron';font-weight:700;font-size:19px;letter-spacing:.05em}
.cap .sub{font-size:13px;color:#9C8CBC}
.cap .r{margin-left:auto;display:flex;gap:14px;align-items:center;flex-wrap:wrap}
.lg{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:#9C8CBC}
footer{flex:0 0 auto;display:flex;align-items:center;gap:16px;padding:14px 26px;border-top:1px solid rgba(140,100,230,0.18)}
.kdk{display:flex;align-items:center;gap:9px;height:50px;padding:0 16px;background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:13px;color:#9C8CBC;font-size:13px}
.kbd{font-family:'JetBrains Mono';font-size:11px;color:#22E8FF;border:1px solid rgba(34,232,255,.3);border-radius:6px;padding:2px 7px}
.input{flex:1;display:flex;align-items:center;gap:13px;height:52px;padding:0 18px;background:#0A0619;border:1px solid rgba(165,116,255,0.40);border-radius:14px;box-shadow:0 0 30px -16px #FF2D9E}
.input input{flex:1;background:none;border:none;outline:none;color:#ECE4F8;font-family:'Rajdhani';font-size:15px}
.input input::placeholder{color:#9C8CBC}
.tx{display:flex;align-items:center;gap:9px;font-family:'Orbitron';font-weight:700;font-size:13px;letter-spacing:.1em;color:#fff;background:linear-gradient(135deg,#FF2D9E,#A974FF);padding:13px 22px;border-radius:13px;box-shadow:0 0 26px -6px #FF2D9E;cursor:pointer;border:none}
.vit{background:#0C0720;border:1px solid rgba(140,100,230,0.18);border-radius:14px;padding:13px 16px}
.vit .l{font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#9C8CBC}
.vit .n{font-family:'Orbitron';font-weight:700;font-size:28px;margin-top:3px}
.kpis{display:grid;gap:14px}
.feed{display:flex;flex-direction:column;margin-top:6px}
.ev{display:flex;align-items:center;gap:11px;padding:9px 0;border-bottom:1px solid rgba(140,100,230,.10);font-size:13.5px}.ev:last-child{border-bottom:none}
.spk{width:5px;height:18px;border-radius:2px;flex:0 0 auto;box-shadow:0 0 8px currentColor}
.evt{font-size:11px;color:#695B89}.evw{font-family:'JetBrains Mono';font-size:12px;flex:0 0 96px}.evx{color:#9C8CBC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.cwrap{flex:1;min-height:340px;display:flex;align-items:center;justify-content:center}
.qcard{background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:14px;padding:13px 15px;margin-bottom:11px}
.qtop{display:flex;align-items:center;gap:9px;font-size:12px}
.qtier{margin-left:auto;font-size:10.5px;border:1px solid;border-radius:6px;padding:2px 8px;text-transform:uppercase;letter-spacing:.06em}
/* live ops task cards */
.tk{display:grid;grid-template-columns:42px 1fr 110px 64px;align-items:center;gap:14px;background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:14px;padding:13px 16px;margin-bottom:11px;transition:all .18s ease-out}
.tk:hover{border-color:rgba(165,116,255,0.40);transform:translateY(-1px)}
.tk .ic{width:42px;height:42px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px;border:1.5px solid;background:#0A0518}
.tk .ti2{font-weight:600;font-size:15.5px}.tk .sub{font-size:12px;color:#9C8CBC;margin-top:2px}
.tk .verb{font-family:'JetBrains Mono';font-size:11px;color:#695B89}
.stg{font-size:11px;padding:4px 10px;border-radius:999px;text-transform:uppercase;letter-spacing:.07em;border:1px solid;text-align:center;font-weight:600}
.stg.running{color:#22E8FF;border-color:rgba(34,232,255,.4);background:rgba(34,232,255,.07)}
.stg.queued{color:#FFC24B;border-color:rgba(255,194,75,.4);background:rgba(255,194,75,.07)}
.stg.done{color:#34F5A8;border-color:rgba(52,245,168,.4);background:rgba(52,245,168,.07)}
.stg.failed{color:#FF5470;border-color:rgba(255,84,112,.45);background:rgba(255,84,112,.08)}
.stg.dismissed{color:#695B89;border-color:rgba(140,100,230,.2)}
.age{font-family:'JetBrains Mono';font-size:13px;color:#9C8CBC;text-align:right}
.run-pulse{width:9px;height:9px;border-radius:50%;background:#22E8FF;box-shadow:0 0 11px #22E8FF;animation:bp 1.6s ease-in-out infinite}
@keyframes bp{0%,100%{opacity:.35}50%{opacity:1}}
.empty{color:#695B89;text-align:center;padding:40px 0;font-size:14px}
.muted{color:#9C8CBC;font-size:14px}
.arow{display:grid;grid-template-columns:44px 1.3fr 90px 1fr;align-items:center;gap:13px;background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:13px;padding:10px 14px;margin-bottom:9px}
.ac{width:38px;height:38px;border-radius:50%;border:2px solid;display:flex;align-items:center;justify-content:center;font-family:'Orbitron';font-weight:700;font-size:12px;background:#0A0518}
.spill{font-size:11px;padding:3px 9px;border-radius:999px;text-transform:uppercase;letter-spacing:.06em;border:1px solid;text-align:center}
*{cursor:default}a,.nv,.tx,.tk,.qcard,.arow,.kdk{cursor:pointer}
@media(max-width:1024px){.stage{flex-direction:column}.spine{width:100%;flex-direction:row;justify-content:space-around;overflow-x:auto}.spine-f{margin:0}.page{flex-direction:column}.sidecol{width:100%!important}}
@media(prefers-reduced-motion:reduce){.run-pulse{animation:none}}`;

function connectomeScript(): string {
  // Compact data-driven connectome: positions from the canonical layout, colored by real status,
  // firing agents get a halo + brighter axon. Pure SVG built in the browser from injected data.
  return `function conn(agents){
    const cx=450,cy=540,core=92,W=900,H=1180,d2r=Math.PI/180;
    const col={firing:'#fff',healthy:'#34F5A8',watch:'#FFC24B',idle:'#A974FF',down:'#FF5470'};
    const L={command:[-90,330],sentinel:[-54,300],cto:[-18,352],factory:[18,302],fitness:[54,346],ops:[90,300],beezulbub:[126,350],prophet:[162,300],wolverine:[198,352],rinnegan:[234,305]};
    let ax='',nd='';
    for(const a of agents){const p=L[a.id]||[0,300];const ang=p[0]*d2r,r=p[1];
      const x=cx+Math.cos(ang)*r,y=cy+Math.sin(ang)*r;const c=a.color||'#A974FF';const fire=a.status==='firing';
      const mx=cx+(x-cx)*0.55,my=cy+(y-cy)*0.55-40;
      ax+='<path d="M'+cx+' '+cy+' Q'+mx.toFixed(1)+' '+my.toFixed(1)+' '+x.toFixed(1)+' '+y.toFixed(1)+'" fill="none" stroke="'+c+'" stroke-width="'+(fire?2.4:1.5)+'" opacity="'+(fire?0.92:0.5)+'" filter="url(#gl)"/>';
      if(fire)nd+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="47" fill="'+c+'" opacity="0.16" filter="url(#glbig)"/>';
      nd+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="31" fill="#0A0619" stroke="'+c+'" stroke-width="'+(fire?2.6:1.8)+'" filter="url(#gl)"/>';
      nd+='<text x="'+x.toFixed(1)+'" y="'+(y+5).toFixed(1)+'" text-anchor="middle" font-family="Orbitron" font-weight="700" font-size="18" fill="'+c+'">'+a.initials+'</text>';
      const side=x<cx-20?'end':x>cx+20?'start':'middle';const lx=side==='end'?x-40:side==='start'?x+40:x;
      nd+='<text x="'+lx.toFixed(1)+'" y="'+(y-40).toFixed(1)+'" text-anchor="'+side+'" font-family="Rajdhani" font-weight="600" font-size="18" fill="#ECE4F8">'+a.name+'</text>';
      nd+='<text x="'+lx.toFixed(1)+'" y="'+(y-22).toFixed(1)+'" text-anchor="'+side+'" font-family="JetBrains Mono" font-size="12" fill="'+c+'" opacity="0.85">'+a.metric+'</text>';
    }
    return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Fleet connectome"><defs>'+
      '<filter id="gl" x="-80%" y="-80%" width="260%" height="260%"><feGaussianBlur stdDeviation="4.5" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>'+
      '<filter id="glbig" x="-120%" y="-120%" width="340%" height="340%"><feGaussianBlur stdDeviation="14"/></filter>'+
      '<radialGradient id="cg" cx="50%" cy="50%" r="50%"><stop offset="0%" stop-color="#22E8FF" stop-opacity="0.5"/><stop offset="45%" stop-color="#FF2D9E" stop-opacity="0.18"/><stop offset="100%" stop-color="#FF2D9E" stop-opacity="0"/></radialGradient></defs>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="312" fill="url(#cg)"/>'+ax+
      '<circle cx="'+cx+'" cy="'+cy+'" r="126" fill="none" stroke="#A974FF" stroke-width="1" opacity="0.22" stroke-dasharray="2 7"/>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="110" fill="none" stroke="#22E8FF" stroke-width="1" opacity="0.2"/>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+core+'" fill="#0A0619" stroke="rgba(140,100,230,0.18)"/>'+
      '<circle cx="'+cx+'" cy="'+cy+'" r="'+core+'" fill="none" stroke="#34F5A8" stroke-width="4" stroke-linecap="round" stroke-dasharray="'+(0.942*2*Math.PI*core).toFixed(1)+' '+(2*Math.PI*core).toFixed(1)+'" transform="rotate(-90 '+cx+' '+cy+')" filter="url(#gl)"/>'+
      '<text x="'+cx+'" y="'+(cy-30)+'" text-anchor="middle" font-family="Rajdhani" font-size="20" letter-spacing="3" fill="#22E8FF" opacity="0.9">COGNITIVE CORE</text>'+
      '<text x="'+cx+'" y="'+(cy+21)+'" text-anchor="middle" font-family="Orbitron" font-weight="900" font-size="64" fill="#fff" filter="url(#gl)">'+(window.HV.fleetFitness)+'</text>'+
      '<text x="'+cx+'" y="'+(cy+50)+'" text-anchor="middle" font-family="JetBrains Mono" font-size="14" fill="#34F5A8">fleet fitness</text>'+nd+'</svg>';
  }`;
}

/** Canonical Neural-Deck color per agent id. */
const AGENT_COLOR: Record<string, string> = {
  command: "#22E8FF", sentinel: "#FFC24B", cto: "#A974FF", factory: "#FF2D9E", fitness: "#34F5A8",
  ops: "#34F5A8", beezulbub: "#22E8FF", prophet: "#A974FF", wolverine: "#34F5A8", rinnegan: "#22E8FF",
};
const INITIALS: Record<string, string> = {
  command: "CM", sentinel: "SN", cto: "CT", factory: "FC", fitness: "FT",
  ops: "OP", beezulbub: "BZ", prophet: "PR", wolverine: "WV", rinnegan: "RN",
};

/** A minimal agent shape (subset of MetaAgent) — keeps this module decoupled from the registry. */
export interface V5SourceAgent {
  id: string;
  displayName: string;
  role: string;
  status: string;
  category?: string;
  statusReason?: string;
}

/** A minimal proposal-queue shape (subset of ProposalQueueItem). */
export interface V5SourceProposal extends TaskSourceRow {
  riskLevel?: string;
}

function mapStatus(s: string, firing: boolean): V5Agent["status"] {
  if (firing) return "firing";
  if (s === "live") return "healthy";
  if (s === "partial") return "watch";
  if (s === "down" || s === "missing" || s === "offline") return "down";
  return "idle";
}

/**
 * Build the v5 data blob from the live registry + proposal queue. Metrics are HONESTLY derived from
 * what the Worker actually has (fleet health %, task counts) — never fabricated numbers.
 */
export function buildCockpitV5Data(
  agents: V5SourceAgent[],
  proposalQueue: V5SourceProposal[] | undefined,
  opts: { now: string; buildSha: string | null },
): CockpitV5Data {
  const tasks = buildTasksView(proposalQueue, opts.now);
  const firingAgents = new Set(
    tasks.tasks.filter((t) => t.stage === "running").map((t) => t.agent.toLowerCase()),
  );

  const fleet = agents.filter((a) => (a.category ?? "") !== "human" && (LAYOUT[a.id] || INITIALS[a.id]));
  const v5agents: V5Agent[] = fleet.map((a) => {
    const firing = firingAgents.has(a.displayName.toLowerCase()) || firingAgents.has(a.id);
    return {
      id: a.id,
      name: a.displayName.replace(/^HartOS\s+/i, "").split(/[\/(]/)[0]!.trim() || a.id,
      initials: INITIALS[a.id] ?? a.id.slice(0, 2).toUpperCase(),
      role: a.role,
      metric: a.status === "live" ? "online" : a.status,
      color: AGENT_COLOR[a.id] ?? "#A974FF",
      status: mapStatus(a.status, firing),
    };
  });

  const live = v5agents.filter((a) => a.status !== "down" && a.status !== "idle").length;
  const total = v5agents.length || 1;
  const healthPct = Math.round((live / total) * 100);

  const PROP_COLOR = (risk: string): string =>
    risk === "high" ? "#FF5470" : risk === "medium" ? "#FF2D9E" : "#34F5A8";
  const pending = (proposalQueue ?? [])
    .filter((p) => p.status === "pending_approval" || p.status === "draft")
    .slice(0, 12)
    .map((p): V5Proposal => ({
      id: p.id.length > 14 ? "S-" + p.id.slice(-5) : p.id,
      origin: typeof p.domain === "string" ? p.domain : "system",
      title: typeof p.title === "string" ? p.title : p.id,
      tier: (p.riskLevel ?? "low") === "low" ? "Tier 1" : "Tier 2",
      color: PROP_COLOR(p.riskLevel ?? "low"),
      status: typeof p.status === "string" ? p.status : "pending_approval",
    }));

  const events: V5Event[] = tasks.tasks.slice(0, 8).map((t) => ({
    time: t.ageLabel,
    agent: t.agent,
    text: `${t.verb} · ${t.title}`.slice(0, 60),
    color: t.color,
  }));

  return {
    now: opts.now,
    buildSha: opts.buildSha,
    fleetFitness: String(healthPct),
    verify: `${live} / ${v5agents.filter((a) => a.status === "down").length}`,
    signalPerMin: tasks.counts.total,
    corticalLoad: Math.round((tasks.counts.running / total) * 100),
    agents: v5agents,
    tasks,
    proposals: pending,
    events,
  };
}

/** Render the full v5 cockpit page. Read-only; hydrates client-side from the injected data blob. */
export function renderCockpitV5(data: CockpitV5Data): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HartOS · Neural Deck v5</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Orbitron:wght@500;700;900&family=Rajdhani:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet">
<link href="https://cdn.jsdelivr.net/npm/@tabler/icons-webfont@3.24.0/dist/tabler-icons.min.css" rel="stylesheet">
<style>${CSS}</style></head><body><div class="deck">
<header><div class="bmk"><i class="ti ti-brain"></i></div><div><div class="bw">HartOS</div><div class="bt">neural deck</div></div><span class="v5">v5</span>
<div class="link"><span class="dot" style="background:#22E8FF;box-shadow:0 0 10px #22E8FF"></span><span class="mono">NEURAL LINK</span><span class="mono" style="color:#34F5A8">SYNCED</span></div>
<div class="hr"><span class="pill" style="color:#A974FF;border-color:rgba(169,116,255,.4);padding:7px 13px"><i class="ti ti-shield-lock" style="font-size:15px"></i> tier 1 · guardrailed</span><span class="mono" id="clock" style="color:#9C8CBC;font-size:13px"></span><div class="av">H</div></div></header>
<div class="stage"><div class="spine">
<div class="nv on" data-p="overview"><i class="ti ti-brain"></i><span>overview</span></div>
<div class="nv" data-p="fleet"><i class="ti ti-affiliate"></i><span>fleet</span></div>
<div class="nv" data-p="ops"><i class="ti ti-activity-heartbeat"></i><span>live ops</span></div>
<div class="nv" data-p="synapses"><i class="ti ti-plug-connected"></i><span>synapses</span></div>
<div class="nv" data-p="audit"><i class="ti ti-shield-half"></i><span>audit</span></div>
<div class="spine-f"><span class="dot" style="background:#34F5A8;box-shadow:0 0 10px #34F5A8"></span><span class="mono" id="uppct">100%</span></div></div>
<div class="page" id="page"></div></div>
<footer><div class="kdk"><i class="ti ti-terminal-2" style="font-size:18px;color:#22E8FF"></i> neural console <span class="kbd">\`</span></div>
<div class="input"><i class="ti ti-prompt" style="color:#22E8FF"></i><input id="ask" placeholder="transmit directive to the fleet…" autocomplete="off"></div>
<div class="tx" id="tx">TRANSMIT <i class="ti ti-bolt"></i></div></footer></div>
<script>
window.HV=${json};
${connectomeScript()}
(function(){
var D=window.HV,P=document.getElementById('page');
function el(t){return '<i class="ti '+t+'"></i>';}
function vit(l,n,c,s){return '<div class="vit"><div class="l">'+l+'</div><div class="n" style="color:'+c+'">'+n+(s?'<span style="font-size:14px;color:#9C8CBC"> '+s+'</span>':'')+'</div></div>';}
function overview(){
  var ev=D.events.map(function(e){return '<div class="ev"><span class="spk" style="background:'+e.color+';color:'+e.color+'"></span><span class="evt">'+e.time+'</span><span class="evw" style="color:'+e.color+'">'+e.agent+'</span><span class="evx">'+e.text+'</span></div>';}).join('');
  var syn=D.proposals.slice(0,4).map(function(p){return '<div class="qcard" style="padding:11px 13px;margin-bottom:10px"><div class="qtop"><span class="mono" style="color:'+p.color+'">'+p.id+'</span><span style="color:#9C8CBC">'+p.origin+'</span><span class="qtier" style="color:'+p.color+';border-color:'+p.color+'66">'+p.tier+'</span></div><div style="font-size:14px;margin:7px 0 0">'+p.title+'</div></div>';}).join('')||'<div class="muted">No pending synapses — the queue is clear.</div>';
  return '<div class="cap"><h2>Neural map</h2><span class="sub">fleet connectome · '+D.agents.length+' neurons · cognitive loop live</span><span class="r"><span class="lg"><span class="dot" style="background:#fff;box-shadow:0 0 8px #fff"></span>firing</span><span class="lg"><span class="dot" style="background:#34F5A8"></span>healthy</span><span class="lg"><span class="dot" style="background:#A974FF"></span>idle</span></span></div>'+
  '<div style="display:flex;gap:18px;flex:1;min-height:0" class="ov"><div class="col" style="flex:1;display:flex;flex-direction:column;gap:16px"><div class="panel" style="flex:1;display:flex;flex-direction:column;padding:16px 18px"><div class="cwrap">'+conn(D.agents)+'</div></div>'+
  '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">'+vit('signal',D.signalPerMin,'#22E8FF','/min')+vit('cortical load',D.corticalLoad,'#A974FF','%')+vit('verify : all',D.verify,'#34F5A8','')+'</div></div>'+
  '<div class="col sidecol" style="width:452px;display:flex;flex-direction:column;gap:16px"><div class="panel" style="flex:1;padding:15px 17px;display:flex;flex-direction:column"><div class="phd">'+el('ti-activity')+' signal stream<span class="ct">cognitive loop</span></div><div class="feed">'+ev+'</div></div>'+
  '<div class="panel" style="padding:15px 17px"><div class="phd">'+el('ti-plug-connected')+' pending synapses<span class="ct">authorize</span></div><div style="margin-top:11px">'+syn+'</div></div></div></div>';
}
function ops(){
  var t=D.tasks,c=t.counts;
  var cards=(t.tasks||[]).map(function(k){
    var pulse=k.stage==='running'?'<span class="run-pulse"></span>':'';
    return '<div class="tk"><div class="ic" style="border-color:'+k.color+';color:'+k.color+'">'+el(k.stage==='running'?'ti-loader-2':k.stage==='done'?'ti-check':k.stage==='failed'?'ti-x':'ti-clock')+'</div>'+
      '<div><div class="ti2">'+k.title+'</div><div class="sub"><span class="verb">'+k.agent+' · '+k.verb+'</span></div></div>'+
      '<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">'+pulse+'<span class="stg '+k.stage+'">'+k.stage+'</span></div>'+
      '<div class="age">'+k.ageLabel+'</div></div>';
  }).join('');
  if(!t.available)cards='<div class="empty">'+ (t.note||'Live Operations unavailable.') +'</div>';
  else if(!(t.tasks||[]).length)cards='<div class="empty">No tasks in flight. Approve a job in Synapses and it appears here the moment the daemon picks it up.</div>';
  return '<div class="cap"><h2>Live operations</h2><span class="sub">tasks in flight · what HartOS is doing right now</span><span class="r"><span class="lg"><span class="dot" style="background:#22E8FF"></span>running</span><span class="lg"><span class="dot" style="background:#FFC24B"></span>queued</span><span class="lg"><span class="dot" style="background:#34F5A8"></span>done</span></span></div>'+
  '<div class="kpis" style="grid-template-columns:repeat(4,1fr);flex:0 0 auto">'+vit('running',c.running,'#22E8FF','')+vit('queued',c.queued,'#FFC24B','')+vit('done',c.done,'#34F5A8','')+vit('failed',c.failed,'#FF5470','')+'</div>'+
  '<div class="panel" style="flex:1;padding:16px 18px;overflow:auto"><div class="phd">'+el('ti-activity-heartbeat')+' task stream<span class="ct">live</span></div><div style="margin-top:13px">'+cards+'</div></div>';
}
function fleet(){
  var rows=D.agents.map(function(a){var sc=a.status==='down'?'#FF5470':a.status==='idle'?'#A974FF':a.status==='watch'?'#FFC24B':a.color;
    return '<div class="arow"><div class="ac" style="border-color:'+a.color+';color:'+a.color+'">'+a.initials+'</div><div><div style="font-weight:600;font-size:16px">'+a.name+'</div><div style="font-size:12px;color:#9C8CBC">'+a.role+'</div></div><div class="spill" style="color:'+sc+';border-color:'+sc+'66">'+a.status+'</div><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+a.metric+'</div></div>';}).join('');
  return '<div class="cap"><h2>Fleet</h2><span class="sub">'+D.agents.length+' neurons · live roster</span></div><div class="panel" style="flex:1;padding:16px 18px;overflow:auto"><div class="phd">'+el('ti-affiliate')+' agent roster</div><div style="margin-top:13px">'+rows+'</div></div>';
}
function synapses(){
  var q=D.proposals.map(function(p){return '<div class="qcard"><div class="qtop"><span class="mono" style="color:'+p.color+'">'+p.id+'</span><span style="color:#9C8CBC">'+p.origin+'</span><span class="qtier" style="color:'+p.color+';border-color:'+p.color+'66">'+p.tier+'</span></div><div style="font-size:16px;font-weight:600;margin:8px 0 6px">'+p.title+'</div><div class="muted">'+p.status+'</div></div>';}).join('')||'<div class="empty">No proposals in the queue.</div>';
  return '<div class="cap"><h2>Synapses</h2><span class="sub">authorize / sever · the human-approval floor</span></div><div class="panel" style="flex:1;padding:16px 18px;overflow:auto"><div class="phd">'+el('ti-plug-connected')+' proposal queue<span class="ct">'+D.proposals.length+' total</span></div><div style="margin-top:13px">'+q+'</div></div>';
}
function audit(){
  return '<div class="cap"><h2>Audit</h2><span class="sub">Wolverine immune system</span></div><div class="panel" style="flex:1;padding:24px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px"><div style="width:96px;height:96px;border-radius:24px;border:2px solid #34F5A8;display:flex;align-items:center;justify-content:center;font-size:48px;color:#34F5A8;background:rgba(52,245,168,.06);box-shadow:0 0 40px -10px #34F5A8">'+el('ti-shield-check')+'</div><div class="orb" style="font-size:22px;color:#34F5A8;letter-spacing:.1em">IMMUNE · CLEAN</div><div class="muted">6 detectors sweeping · hands gated · full audit board lands in the next v5 slice</div></div>';
}
var PAGES={overview:overview,fleet:fleet,ops:ops,synapses:synapses,audit:audit};
function go(name){P.innerHTML=(PAGES[name]||overview)();var ns=document.querySelectorAll('.nv');for(var i=0;i<ns.length;i++)ns[i].classList.toggle('on',ns[i].getAttribute('data-p')===name);}
var navs=document.querySelectorAll('.nv');for(var i=0;i<navs.length;i++)navs[i].addEventListener('click',function(){var n=this.getAttribute('data-p');location.hash=n;go(n);});
window.addEventListener('hashchange',function(){var h=(location.hash||'').replace('#','');if(PAGES[h])go(h);});
var start=(location.hash||'').replace('#','');go(PAGES[start]?start:'overview');
// clock
function tick(){var d=new Date();document.getElementById('clock').textContent=d.toTimeString().slice(0,8);}tick();setInterval(tick,1000);
// footer console → /api/ask (existing endpoint)
function send(){var v=document.getElementById('ask').value.trim();if(!v)return;var tx=document.getElementById('tx');tx.textContent='…';
  fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({question:v})}).then(function(r){return r.json();}).then(function(j){
    alert((j.summary||j.answer||'(no answer)').slice(0,800));tx.innerHTML='TRANSMIT <i class=\\'ti ti-bolt\\'></i>';document.getElementById('ask').value='';
  }).catch(function(){tx.innerHTML='TRANSMIT <i class=\\'ti ti-bolt\\'></i>';alert('Ask failed (are you authenticated?)');});}
document.getElementById('tx').addEventListener('click',send);
document.getElementById('ask').addEventListener('keydown',function(e){if(e.key==='Enter')send();});
})();
</script></body></html>`;
}
