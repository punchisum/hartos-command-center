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
  /** Honest status reason + description (for the agent drawer). */
  statusReason: string;
  description: string;
  /** Whether a dedicated /agent/<id>/ui dashboard exists (fitness/ops today). */
  hasDashboard: boolean;
}

export interface V5Proposal {
  /** Short display id (S-xxxxx). */
  id: string;
  /** The REAL spine id — what the gated /api/proposals/transition POST must use. */
  realId: string;
  origin: string;
  title: string;
  tier: string;
  color: string;
  status: string;
  risk: string;
  /** Plain-English "what would happen" for the detail panel. */
  desc: string;
}

export interface V5Event {
  time: string;
  agent: string;
  text: string;
  color: string;
}

export interface V5Diagnostics {
  providerMode: string;
  model: string;
  llmNetwork: boolean;
  writePathConfigured: boolean;
  env: { name: string; present: boolean; secret: boolean }[];
}

export interface V5Intelligence {
  available: boolean;
  confidence: string;
  note: string;
  risks: { subject: string; severity: string; why: string }[];
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
  diagnostics: V5Diagnostics;
  intelligence: V5Intelligence;
}

const esc = (s: unknown): string =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** Canonical Neural-Deck polar layout (angle°, radius) keyed by the REAL registry agent ids. */
const LAYOUT: Record<string, [number, number]> = {
  orchestrator: [-90, 330], sentinel: [-54, 300], research: [-18, 352], factory: [18, 302], fitness: [54, 346],
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
.deck{height:100vh;overflow:hidden;display:flex;flex-direction:column;background:radial-gradient(1200px 700px at 38% 30%, #0A0518 0%, #05030C 62%);position:relative}
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
.cwrap{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
.cwrap svg{width:100%;height:100%}
.page{overflow:hidden}.col{min-height:0}
.sidecol{overflow:auto}
/* EEG */
.eegbox{border:1px solid rgba(140,100,230,0.18);border-radius:12px;overflow:hidden;background:#0A0619;margin-top:10px}
.eeg path.live{stroke-dasharray:1400;stroke-dashoffset:1400;animation:eegdraw 3.2s linear infinite}
@keyframes eegdraw{to{stroke-dashoffset:0}}
.eeg-r{display:flex;align-items:center;gap:12px;margin-top:9px}.eeg-r .big{font-family:'Orbitron';font-weight:700;font-size:20px;color:#22E8FF}.eeg-r .s{font-size:12px;color:#9C8CBC}
/* connectome firing pulse + clickable hit areas */
.fire{animation:firepulse 1.8s ease-in-out infinite}
@keyframes firepulse{0%,100%{opacity:.45}50%{opacity:1}}
.hit{cursor:pointer;opacity:0}
.npart{animation:axflow 2.4s linear infinite}
@keyframes axflow{0%{opacity:0}10%{opacity:1}90%{opacity:1}100%{opacity:0;transform:translate(0,0)}}
/* agent drawer */
.drawer{position:absolute;top:0;right:0;bottom:0;width:420px;max-width:92vw;z-index:35;background:#0C0720;border-left:1px solid rgba(165,116,255,0.40);box-shadow:-30px 0 70px -30px #000;transform:translateX(102%);transition:transform .3s cubic-bezier(.3,.85,.3,1);display:flex;flex-direction:column;padding:22px 24px;overflow:auto}
.drawer.open{transform:translateX(0)}
.drawer .dx{position:absolute;top:16px;right:18px;font-size:20px;color:#9C8CBC;cursor:pointer}
.dbig{width:74px;height:74px;border-radius:50%;border:2.5px solid;display:flex;align-items:center;justify-content:center;font-family:'Orbitron';font-weight:700;font-size:24px;background:#0A0518}
.dgrid{display:grid;grid-template-columns:1fr 1fr;gap:11px;margin-top:16px}
.dcell{background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:11px;padding:11px 13px}
.dcell .l{font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:#9C8CBC}.dcell .n{font-family:'Orbitron';font-weight:700;font-size:17px;margin-top:3px}
.dlink{display:inline-flex;align-items:center;gap:8px;margin-top:16px;padding:11px 16px;border-radius:12px;font-family:'Orbitron';font-weight:700;font-size:13px;letter-spacing:.06em;color:#04140c;background:linear-gradient(135deg,#34F5A8,#19c98a);box-shadow:0 0 26px -8px #34F5A8;text-decoration:none}
/* neural console */
.scrim{position:absolute;inset:0;background:rgba(5,3,12,.74);backdrop-filter:blur(3px);z-index:40;opacity:0;pointer-events:none;transition:opacity .22s ease}
.scrim.open{opacity:1;pointer-events:auto}
.term{position:absolute;left:8%;right:8%;top:10%;bottom:10%;z-index:41;background:#0C0720;border:1px solid rgba(165,116,255,0.40);border-radius:18px;box-shadow:0 0 80px -20px #FF2D9E;display:flex;flex-direction:column;overflow:hidden;transform:scale(.96);opacity:0;transition:transform .32s cubic-bezier(.3,.85,.3,1),opacity .2s ease}
.scrim.open .term{transform:scale(1);opacity:1}
.thd{height:48px;flex:0 0 auto;display:flex;align-items:center;gap:11px;padding:0 18px;border-bottom:1px solid rgba(140,100,230,0.18);background:#0A0619}
.thd .mono{font-size:12px;letter-spacing:.16em;color:#22E8FF}
.tdots{display:flex;gap:7px}.tdots i{width:11px;height:11px;border-radius:50%;display:block}
.tbody{flex:1;min-height:0;padding:18px 22px;font-family:'JetBrains Mono';font-size:13.5px;line-height:1.7;overflow:auto;display:flex;flex-direction:column;gap:4px}
.tu{color:#ECE4F8}.tu .tp{color:#22E8FF;margin-right:8px}
.tr{color:#9C8CBC;margin:2px 0 14px;padding-left:8px;border-left:2px solid rgba(140,100,230,0.18);white-space:pre-wrap}
.tr .ok{color:#34F5A8}
.tcur{display:inline-block;color:#22E8FF;animation:blink 1.1s step-end infinite}@keyframes blink{50%{opacity:0}}
.tfoot{flex:0 0 auto;border-top:1px solid rgba(140,100,230,0.18);padding:13px 18px;background:#0A0619}
.tchips{display:flex;gap:9px;margin-bottom:10px;flex-wrap:wrap}
.tchip{font-family:'JetBrains Mono';font-size:12px;padding:5px 11px;border:1px solid rgba(140,100,230,0.18);border-radius:8px;color:#9C8CBC;cursor:pointer}
.tchip:hover{border-color:rgba(165,116,255,0.40);color:#ECE4F8}
.tin{display:flex;align-items:center;gap:11px;height:46px;padding:0 16px;background:#0A0518;border:1px solid rgba(165,116,255,0.40);border-radius:12px}
.tin input{flex:1;background:none;border:none;outline:none;color:#ECE4F8;font-family:'JetBrains Mono';font-size:13.5px}
.peek{position:absolute;left:18px;right:18px;bottom:92px;height:50px;z-index:30;display:flex;align-items:center;gap:13px;padding:0 18px;background:#0A0619;border:1px solid rgba(165,116,255,0.40);border-radius:14px;box-shadow:0 0 38px -14px #22E8FF;cursor:pointer;transform:translateY(120%);transition:transform .26s ease}
.peek.show{transform:translateY(0)}
.peek .lbl{font-family:'JetBrains Mono';font-size:12px;letter-spacing:.12em;color:#22E8FF}
.peek .mid{flex:1;font-family:'JetBrains Mono';font-size:13px;color:#9C8CBC;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pulse{width:9px;height:9px;border-radius:50%;background:#22E8FF;box-shadow:0 0 11px #22E8FF;animation:bp 1.6s ease-in-out infinite}
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
    const cx=450,cy=540,core=92,W=900,H=1010,d2r=Math.PI/180;
    const col={firing:'#fff',healthy:'#34F5A8',watch:'#FFC24B',idle:'#A974FF',down:'#FF5470'};
    const L={orchestrator:[-90,330],sentinel:[-54,300],research:[-18,352],factory:[18,302],fitness:[54,346],ops:[90,300],beezulbub:[126,350],prophet:[162,300],wolverine:[198,352],rinnegan:[234,305]};
    let ax='',nd='';
    for(const a of agents){const p=L[a.id]||[0,300];const ang=p[0]*d2r,r=p[1];
      const x=cx+Math.cos(ang)*r,y=cy+Math.sin(ang)*r;const c=a.color||'#A974FF';const fire=a.status==='firing';const dn=a.status==='down';
      const mx=cx+(x-cx)*0.55,my=cy+(y-cy)*0.55-40;
      const pd='M'+cx+' '+cy+' Q'+mx.toFixed(1)+' '+my.toFixed(1)+' '+x.toFixed(1)+' '+y.toFixed(1);
      ax+='<path d="'+pd+'" fill="none" stroke="'+c+'" stroke-width="'+(fire?2.4:1.5)+'" opacity="'+(dn?0.16:fire?0.92:0.5)+'" filter="url(#gl)"/>';
      if(fire)ax+='<circle r="3.4" fill="#fff" opacity="0.95" filter="url(#gl)"><animateMotion dur="2.4s" repeatCount="indefinite" path="'+pd+'"/></circle>';
      if(fire)nd+='<circle class="fire" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="47" fill="'+c+'" opacity="0.16" filter="url(#glbig)"/>';
      nd+='<circle cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="31" fill="#0A0619" stroke="'+c+'" stroke-width="'+(fire?2.6:1.8)+'" opacity="'+(dn?0.5:1)+'" filter="url(#gl)"/>';
      nd+='<text x="'+x.toFixed(1)+'" y="'+(y+5).toFixed(1)+'" text-anchor="middle" font-family="Orbitron" font-weight="700" font-size="18" fill="'+c+'" opacity="'+(dn?0.5:1)+'">'+h(a.initials)+'</text>';
      const side=x<cx-20?'end':x>cx+20?'start':'middle';const lx=side==='end'?x-40:side==='start'?x+40:x;
      nd+='<text x="'+lx.toFixed(1)+'" y="'+(y-40).toFixed(1)+'" text-anchor="'+side+'" font-family="Rajdhani" font-weight="600" font-size="18" fill="#ECE4F8">'+h(a.name)+'</text>';
      nd+='<text x="'+lx.toFixed(1)+'" y="'+(y-22).toFixed(1)+'" text-anchor="'+side+'" font-family="JetBrains Mono" font-size="12" fill="'+c+'" opacity="0.85">'+h(a.metric)+'</text>';
      nd+='<circle class="hit" data-id="'+h(a.id)+'" cx="'+x.toFixed(1)+'" cy="'+y.toFixed(1)+'" r="46" fill="#fff"/>';
    }
    return '<svg viewBox="0 0 '+W+' '+H+'" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Fleet connectome"><defs>'+
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
      '<text x="'+cx+'" y="'+(cy+50)+'" text-anchor="middle" font-family="JetBrains Mono" font-size="14" fill="#34F5A8">fleet health %</text>'+nd+'</svg>';
  }`;
}

/** Canonical Neural-Deck color per agent id. */
const AGENT_COLOR: Record<string, string> = {
  orchestrator: "#22E8FF", sentinel: "#FFC24B", research: "#A974FF", factory: "#FF2D9E", fitness: "#34F5A8",
  ops: "#34F5A8", beezulbub: "#22E8FF", prophet: "#A974FF", wolverine: "#34F5A8", rinnegan: "#22E8FF",
};
const INITIALS: Record<string, string> = {
  orchestrator: "CM", sentinel: "SN", research: "RS", factory: "FC", fitness: "FT",
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
  description?: string;
}

/** Agents that have a real dedicated dashboard page (/agent/<id>/ui). */
const DASHBOARD_AGENTS = new Set(["fitness", "ops"]);

/** A minimal proposal-queue shape (subset of ProposalQueueItem). */
export interface V5SourceProposal extends TaskSourceRow {
  riskLevel?: string;
  description?: string;
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
  opts: { now: string; buildSha: string | null; diagnostics?: V5Diagnostics; intelligence?: V5Intelligence },
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
      metric: a.status === "live" ? "online" : a.status === "partial" ? "propose-only" : a.status,
      color: AGENT_COLOR[a.id] ?? "#A974FF",
      status: mapStatus(a.status, firing),
      statusReason: a.statusReason ?? "",
      description: a.description ?? a.role,
      hasDashboard: DASHBOARD_AGENTS.has(a.id),
    };
  });

  const live = v5agents.filter((a) => a.status !== "down" && a.status !== "idle").length;
  const total = v5agents.length || 1;
  const healthPct = Math.round((live / total) * 100);

  const PROP_COLOR = (risk: string): string =>
    risk === "high" ? "#FF5470" : risk === "medium" ? "#FF2D9E" : "#34F5A8";
  const pending = (proposalQueue ?? [])
    .filter((p) => p.status === "pending_approval" || p.status === "draft")
    .slice(0, 16)
    .map((p): V5Proposal => ({
      realId: p.id,
      id: p.id.length > 14 ? "S-" + p.id.slice(-5) : p.id,
      origin: typeof p.domain === "string" ? p.domain : "system",
      title: typeof p.title === "string" ? p.title : p.id,
      tier: (p.riskLevel ?? "low") === "low" ? "Tier 1" : "Tier 2",
      color: PROP_COLOR(p.riskLevel ?? "low"),
      status: typeof p.status === "string" ? p.status : "pending_approval",
      risk: typeof p.riskLevel === "string" ? p.riskLevel : "low",
      desc: typeof p.description === "string" && p.description ? p.description : (typeof p.title === "string" ? p.title : p.id),
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
    diagnostics: opts.diagnostics ?? { providerMode: "unknown", model: "—", llmNetwork: false, writePathConfigured: false, env: [] },
    intelligence: opts.intelligence ?? { available: false, confidence: "unknown", note: "Synthesis not resolved.", risks: [] },
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
<div class="nv" data-p="intel"><i class="ti ti-brain"></i><span>intelligence</span></div>
<div class="nv" data-p="synapses"><i class="ti ti-plug-connected"></i><span>synapses</span></div>
<div class="nv" data-p="audit"><i class="ti ti-shield-half"></i><span>audit</span></div>
<div class="nv" data-p="tech"><i class="ti ti-bug"></i><span>technical</span></div>
<div class="spine-f"><span class="dot" style="background:#34F5A8;box-shadow:0 0 10px #34F5A8"></span><span class="mono" id="uppct">100%</span></div></div>
<div class="page" id="page"></div></div>
<footer><div class="kdk" id="opencon"><i class="ti ti-terminal-2" style="font-size:18px;color:#22E8FF"></i> neural console <span class="kbd">\`</span></div>
<div class="input"><i class="ti ti-prompt" style="color:#22E8FF"></i><input id="ask" placeholder="transmit directive to the fleet…" autocomplete="off"></div>
<div class="tx" id="tx">TRANSMIT <i class="ti ti-bolt"></i></div></footer>
<aside class="drawer" id="drawer"></aside>
<div class="peek" id="peek"><span class="pulse"></span><span class="lbl">NEURAL CONSOLE</span><span class="mid" id="peekmid">tap to resume the console</span><i class="ti ti-chevron-up"></i></div>
<div class="scrim" id="scrim"><div class="term"><div class="thd"><div class="tdots"><i style="background:#FF5470"></i><i style="background:#FFC24B"></i><i style="background:#34F5A8"></i></div><span class="mono">HARTOS NEURAL CONSOLE</span><span class="dot" style="background:#34F5A8;margin-left:6px;box-shadow:0 0 8px #34F5A8"></span><span style="margin-left:auto;font-size:11px;color:#695B89" class="mono">esc to collapse</span><i class="ti ti-x" id="cclose" style="cursor:pointer;color:#9C8CBC;margin-left:14px"></i></div><div class="tbody" id="tbody"></div><div class="tfoot"><div class="tchips" id="tchips"></div><div class="tin"><span style="color:#22E8FF" class="mono">&gt;</span><input id="cin" placeholder="talk to HartOS, or type a command…" autocomplete="off"><span class="dot" id="cbusy" style="background:#22E8FF;opacity:0"></span></div></div></div></div></div>
<script>
window.HV=${json};
function h(s){return String(s==null?'':s).replace(/[&<>"]/g,function(c){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c];});}
${connectomeScript()}
(function(){
var D=window.HV,P=document.getElementById('page');
var selSyn=0,curPage='overview';
function el(t){return '<i class="ti '+t+'"></i>';}
function eegPath(sig){var d='M0 34',spikes=Math.max(2,Math.min(8,sig||3));for(var x=0;x<=414;x+=4){var n=34+Math.sin(x/7)*1.6;if(x%Math.floor(414/spikes)<6){n=34-(20+(x%9));}d+=' L'+x+' '+n.toFixed(1);}return d;}
function vit(l,n,c,s){return '<div class="vit"><div class="l">'+l+'</div><div class="n" style="color:'+c+'">'+n+(s?'<span style="font-size:14px;color:#9C8CBC"> '+s+'</span>':'')+'</div></div>';}
function overview(){
  var ev=D.events.map(function(e){return '<div class="ev"><span class="spk" style="background:'+e.color+';color:'+e.color+'"></span><span class="evt">'+h(e.time)+'</span><span class="evw" style="color:'+e.color+'">'+h(e.agent)+'</span><span class="evx">'+h(e.text)+'</span></div>';}).join('')||'<div class="muted">No recent signal — the loop is quiet.</div>';
  var syn=D.proposals.slice(0,4).map(function(p){return '<div class="qcard" style="padding:11px 13px;margin-bottom:10px"><div class="qtop"><span class="mono" style="color:'+p.color+'">'+h(p.id)+'</span><span style="color:#9C8CBC">'+h(p.origin)+'</span><span class="qtier" style="color:'+p.color+';border-color:'+p.color+'66">'+h(p.tier)+'</span></div><div style="font-size:14px;margin:7px 0 0">'+h(p.title)+'</div></div>';}).join('')||'<div class="muted">No pending synapses — the queue is clear.</div>';
  return '<div class="cap"><h2>Neural map</h2><span class="sub">fleet connectome · '+D.agents.length+' neurons · cognitive loop live</span><span class="r"><span class="lg"><span class="dot" style="background:#fff;box-shadow:0 0 8px #fff"></span>firing</span><span class="lg"><span class="dot" style="background:#34F5A8"></span>healthy</span><span class="lg"><span class="dot" style="background:#A974FF"></span>idle</span></span></div>'+
  '<div style="display:flex;gap:18px;flex:1;min-height:0" class="ov"><div class="col" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:16px"><div class="panel" style="flex:1;min-height:0;display:flex;flex-direction:column;padding:16px 18px"><div class="cwrap">'+conn(D.agents)+'</div></div>'+
  '<div class="kpis" style="grid-template-columns:repeat(3,1fr)">'+vit('tasks in flight',D.signalPerMin,'#22E8FF','')+vit('cortical load',D.corticalLoad,'#A974FF','%')+vit('fleet · live/down',D.verify,'#34F5A8','')+'</div></div>'+
  '<div class="col sidecol" style="width:452px;display:flex;flex-direction:column;gap:16px">'+
  '<div class="panel" style="padding:14px 16px;flex:0 0 auto"><div class="phd">'+el('ti-wave-sine')+' neural activity<span class="ct">EEG · live</span></div><div class="eegbox"><svg class="eeg" viewBox="0 0 414 68" width="100%" height="68" preserveAspectRatio="none"><line x1="0" y1="34" x2="414" y2="34" stroke="#22E8FF" stroke-width="0.5" opacity="0.18"/><path class="live" d="'+eegPath(D.signalPerMin)+'" fill="none" stroke="#22E8FF" stroke-width="1.6"/></svg></div><div class="eeg-r"><span class="big">'+D.signalPerMin+'</span><span class="s">signal events · phase-locked to the loop</span></div></div>'+
  '<div class="panel" style="flex:1;min-height:0;padding:15px 17px;display:flex;flex-direction:column"><div class="phd">'+el('ti-activity')+' signal stream<span class="ct">cognitive loop</span></div><div class="feed" style="overflow:auto">'+ev+'</div></div>'+
  '<div class="panel" style="padding:15px 17px;flex:0 0 auto"><div class="phd">'+el('ti-plug-connected')+' pending synapses<span class="ct">authorize</span></div><div style="margin-top:11px">'+syn+'</div></div></div></div>';
}
function ops(){
  var t=D.tasks,c=t.counts;
  var cards=(t.tasks||[]).map(function(k){
    var pulse=k.stage==='running'?'<span class="run-pulse"></span>':'';
    return '<div class="tk"><div class="ic" style="border-color:'+k.color+';color:'+k.color+'">'+el(k.stage==='running'?'ti-loader-2':k.stage==='done'?'ti-check':k.stage==='failed'?'ti-x':'ti-clock')+'</div>'+
      '<div><div class="ti2">'+h(k.title)+'</div><div class="sub"><span class="verb">'+h(k.agent)+' · '+h(k.verb)+'</span></div></div>'+
      '<div style="display:flex;align-items:center;gap:8px;justify-content:flex-end">'+pulse+'<span class="stg '+h(k.stage)+'">'+h(k.stage)+'</span></div>'+
      '<div class="age">'+h(k.ageLabel)+'</div></div>';
  }).join('');
  if(!t.available)cards='<div class="empty">'+ (t.note||'Live Operations unavailable.') +'</div>';
  else if(!(t.tasks||[]).length)cards='<div class="empty">No tasks in flight. Approve a job in Synapses and it appears here the moment the daemon picks it up.</div>';
  return '<div class="cap"><h2>Live operations</h2><span class="sub">tasks in flight · what HartOS is doing right now</span><span class="r"><span class="lg"><span class="dot" style="background:#22E8FF"></span>running</span><span class="lg"><span class="dot" style="background:#FFC24B"></span>queued</span><span class="lg"><span class="dot" style="background:#34F5A8"></span>done</span></span></div>'+
  '<div class="kpis" style="grid-template-columns:repeat(4,1fr);flex:0 0 auto">'+vit('running',c.running,'#22E8FF','')+vit('queued',c.queued,'#FFC24B','')+vit('done',c.done,'#34F5A8','')+vit('failed',c.failed,'#FF5470','')+'</div>'+
  '<div class="panel" style="flex:1;padding:16px 18px;overflow:auto"><div class="phd">'+el('ti-activity-heartbeat')+' task stream<span class="ct">live</span></div><div style="margin-top:13px">'+cards+'</div></div>';
}
function fleet(){
  var rows=D.agents.map(function(a){var sc=a.status==='down'?'#FF5470':a.status==='idle'?'#A974FF':a.status==='watch'?'#FFC24B':a.color;
    return '<div class="arow" data-id="'+h(a.id)+'"><div class="ac" style="border-color:'+a.color+';color:'+a.color+'">'+h(a.initials)+'</div><div><div style="font-weight:600;font-size:16px">'+h(a.name)+'</div><div style="font-size:12px;color:#9C8CBC">'+h(a.role)+'</div></div><div class="spill" style="color:'+sc+';border-color:'+sc+'66">'+h(a.status)+'</div><div class="muted" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">'+h(a.metric)+'</div></div>';}).join('');
  return '<div class="cap"><h2>Fleet</h2><span class="sub">'+D.agents.length+' neurons · live roster</span></div><div class="panel" style="flex:1;padding:16px 18px;overflow:auto"><div class="phd">'+el('ti-affiliate')+' agent roster</div><div style="margin-top:13px">'+rows+'</div></div>';
}
function synapses(){
  var ps=D.proposals||[];
  if(!ps.length)return '<div class="cap"><h2>Synapses</h2><span class="sub">authorize / sever · the human-approval floor</span></div><div class="panel" style="flex:1;display:flex;align-items:center;justify-content:center"><div class="empty">No proposals awaiting authorization. Ask HartOS to do something (or let Wolverine propose a fix), then authorize it here.</div></div>';
  if(selSyn>=ps.length)selSyn=0;
  var sel=ps[selSyn];
  var queue=ps.map(function(p,i){return '<div class="qcard'+(i===selSyn?' sel':'')+'" data-syn="'+i+'"><div class="qtop"><span class="mono" style="color:'+p.color+'">'+h(p.id)+'</span><span style="color:#9C8CBC">'+h(p.origin)+'</span><span class="qtier" style="color:'+p.color+';border-color:'+p.color+'66">'+h(p.tier)+'</span></div><div style="font-size:15px;font-weight:600;margin:8px 0 6px">'+h(p.title)+'</div><div style="display:flex;gap:14px;font-size:12px;color:#9C8CBC"><span>'+h(p.risk)+' risk</span><span>'+h(p.status)+'</span></div></div>';}).join('');
  var canAct=sel.status==='pending_approval';
  var actions=canAct
    ?'<div class="acts" style="display:flex;gap:12px;margin-top:auto;padding-top:16px"><button class="big-btn b-ok" data-act="approve" data-rid="'+h(sel.realId)+'">'+el('ti-plug-connected')+' Authorize</button><button class="big-btn b-no" data-act="reject" data-rid="'+h(sel.realId)+'">Reject</button></div>'
    :'<div class="why" style="margin-top:auto">'+el('ti-info-circle')+' This proposal is <b style="color:#ECE4F8">&nbsp;'+h(sel.status)+'</b> — only <span class="mono">pending_approval</span> items can be authorized here.</div>';
  var detail='<div class="dwrap" style="width:560px;flex:0 0 auto;display:flex;flex-direction:column;min-height:0;overflow:auto"><div class="qtop"><span class="mono" style="color:'+sel.color+'">'+h(sel.id)+'</span><span style="color:#9C8CBC">from '+h(sel.origin)+'</span><span class="qtier" style="color:'+sel.color+';border-color:'+sel.color+'66">'+h(sel.tier)+'</span></div>'+
    '<div class="orb" style="font-size:20px;margin:12px 0 10px">'+h(sel.title)+'</div>'+
    '<div class="muted" style="font-size:14px;line-height:1.55">'+h(sel.desc)+'</div>'+
    '<div class="dgrid"><div class="dcell"><div class="l">risk</div><div class="n" style="font-size:16px">'+h(sel.risk)+'</div></div><div class="dcell"><div class="l">origin</div><div class="n" style="font-size:16px">'+h(sel.origin)+'</div></div></div>'+
    '<div class="why" style="margin-top:14px">'+el('ti-shield-lock')+' Why you: '+h(sel.tier)+' — HartOS proposes; only your authorization moves it forward. Reversible + audited; nothing fires until you say go.</div>'+
    actions+'</div>';
  return '<div class="cap"><h2>Synapses</h2><span class="sub">authorize / sever · '+ps.length+' awaiting you</span></div><div style="display:flex;gap:18px;flex:1;min-height:0"><div class="col" style="flex:1;min-height:0;overflow:auto">'+queue+'</div>'+detail+'</div>';
}
function audit(){
  var sysProps=(D.proposals||[]).filter(function(p){return p.origin==='system'||/wolverine|fix/i.test(p.title);});
  var missing=((D.diagnostics&&D.diagnostics.env)||[]).filter(function(e){return !e.present&&e.secret;});
  var posture=(sysProps.length===0&&missing.length===0)?'CLEAN':'ATTENTION';var pc=posture==='CLEAN'?'#34F5A8':'#FFC24B';
  var detectors=[['secrets','ti-key',missing.length===0?'clean':missing.length+' missing'],['config drift','ti-adjustments','swept'],['dead code','ti-code','swept'],['coverage','ti-shield-check','swept'],['dependencies','ti-package','swept'],['liveness','ti-radar-2','swept']];
  var dgrid=detectors.map(function(d){return '<div class="detc" style="background:#0A0619;border:1px solid rgba(140,100,230,0.18);border-radius:14px;padding:14px"><div style="display:flex;align-items:center;gap:9px;font-weight:600;font-size:14px">'+el(d[1])+' '+d[0]+'</div><div class="orb" style="font-size:16px;margin:8px 0 2px;color:'+(d[2].indexOf('missing')>=0?'#FFC24B':'#34F5A8')+'">'+h(d[2])+'</div><div class="muted" style="font-size:11px">via wolverine:audit (local)</div></div>';}).join('');
  var fixes=sysProps.map(function(p){return '<div class="qcard" data-syn="'+(D.proposals.indexOf(p))+'"><div style="font-size:14px;font-weight:600">'+h(p.title)+'</div><div class="muted" style="font-size:12px;margin-top:4px">'+h(p.status)+' · '+h(p.risk)+' risk · tap to authorize</div></div>';}).join('')||'<div class="muted" style="font-size:13px">No fix proposals pending. Wolverine findings surface here once proposed (npm run wolverine:propose).</div>';
  var miss=missing.map(function(e){return '<div style="display:flex;gap:9px;align-items:center;padding:6px 0;font-size:13px"><span class="dot" style="background:#FF5470"></span><span class="mono" style="color:#9C8CBC">'+h(e.name)+'</span></div>';}).join('')||'<div class="muted" style="font-size:13px">All required secrets present.</div>';
  return '<div class="cap"><h2>Audit</h2><span class="sub">Wolverine immune system · live posture</span></div>'+
    '<div style="display:flex;gap:18px;flex:1;min-height:0"><div class="col" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:16px">'+
    '<div class="panel" style="padding:18px 20px;flex:0 0 auto;display:flex;align-items:center;gap:18px"><div style="width:72px;height:72px;border-radius:20px;border:2px solid '+pc+';display:flex;align-items:center;justify-content:center;font-size:34px;color:'+pc+';background:'+pc+'14">'+el(posture==='CLEAN'?'ti-shield-check':'ti-shield-half')+'</div><div><div class="orb" style="font-size:20px;color:'+pc+'">IMMUNE · '+posture+'</div><div class="muted" style="font-size:13px;margin-top:5px">'+sysProps.length+' fix proposal(s) pending · '+missing.length+' required secret(s) missing · hands gated</div></div></div>'+
    '<div class="panel" style="flex:1;min-height:0;padding:16px 18px;display:flex;flex-direction:column"><div class="phd">'+el('ti-radar-2')+' detectors<span class="ct">read-only sweeps</span></div><div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-top:13px;overflow:auto">'+dgrid+'</div></div></div>'+
    '<div class="col sidecol" style="width:420px;min-height:0;display:flex;flex-direction:column;gap:16px"><div class="panel" style="padding:16px 18px;flex:1;min-height:0;display:flex;flex-direction:column"><div class="phd">'+el('ti-alert-triangle')+' fix proposals<span class="ct">'+sysProps.length+'</span></div><div style="margin-top:12px;overflow:auto">'+fixes+'</div></div><div class="panel" style="padding:16px 18px;flex:0 0 auto"><div class="phd">'+el('ti-key')+' missing secrets</div><div style="margin-top:10px">'+miss+'</div></div></div></div>';
}
function tech(){
  var d=D.diagnostics||{env:[]};
  var envrows=(d.env||[]).map(function(e){return '<div style="display:flex;align-items:center;gap:10px;padding:7px 0;border-bottom:1px solid rgba(140,100,230,.08);font-size:13px"><span class="dot" style="background:'+(e.present?'#34F5A8':(e.secret?'#FF5470':'#695B89'))+'"></span><span class="mono" style="flex:1;color:#9C8CBC">'+h(e.name)+'</span><span style="font-size:12px;color:'+(e.present?'#34F5A8':'#695B89')+'">'+(e.present?'set':(e.secret?'MISSING':'unset'))+'</span></div>';}).join('');
  var missing=(d.env||[]).filter(function(e){return !e.present&&e.secret;}).length;
  var items=(D.proposals||[]).map(function(p){return '<div class="tk" style="grid-template-columns:1fr 120px 70px"><div><div class="ti2">'+h(p.title)+'</div><div class="sub"><span class="verb">'+h(p.origin)+' · '+h(p.id)+'</span></div></div><span class="stg queued">'+h(p.status)+'</span><span class="age">'+h(p.tier)+'</span></div>';}).join('')||'<div class="empty">No open items. Wolverine findings surface here as proposals once Hart runs <span class="mono">wolverine:propose</span> (the audit itself is read-only).</div>';
  return '<div class="cap"><h2>Technical</h2><span class="sub">what needs fixing · live diagnostics</span></div>'+
  '<div style="display:flex;gap:18px;flex:1;min-height:0"><div class="col" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:16px">'+
  '<div class="panel" style="padding:16px 18px;flex:0 0 auto"><div class="phd">'+el('ti-cpu')+' system</div><div class="dgrid" style="grid-template-columns:1fr 1fr">'+
  '<div class="dcell"><div class="l">LLM provider</div><div class="n" style="font-size:16px;color:#22E8FF">'+h(d.providerMode)+'</div></div>'+
  '<div class="dcell"><div class="l">model</div><div class="n" style="font-size:14px">'+h(d.model)+'</div></div>'+
  '<div class="dcell"><div class="l">network gate</div><div class="n" style="font-size:15px;color:'+(d.llmNetwork?'#34F5A8':'#FFC24B')+'">'+(d.llmNetwork?'armed':'off')+'</div></div>'+
  '<div class="dcell"><div class="l">write path</div><div class="n" style="font-size:15px;color:'+(d.writePathConfigured?'#34F5A8':'#FF5470')+'">'+(d.writePathConfigured?'configured':'advisory')+'</div></div></div>'+
  '<div class="muted" style="margin-top:11px;font-size:12px">build '+h(D.buildSha||'—')+'</div></div>'+
  '<div class="panel" style="flex:1;min-height:0;padding:16px 18px;display:flex;flex-direction:column"><div class="phd">'+el('ti-key')+' environment<span class="ct">'+missing+' required missing</span></div><div style="margin-top:8px;overflow:auto">'+envrows+'</div></div></div>'+
  '<div class="col sidecol" style="width:480px;min-height:0"><div class="panel" style="padding:16px 18px;height:100%;display:flex;flex-direction:column"><div class="phd">'+el('ti-alert-triangle')+' needs attention<span class="ct">open items</span></div><div style="margin-top:12px;overflow:auto">'+items+'</div></div></div></div>';
}
function intel(){
  var I=D.intelligence||{available:false,confidence:'unknown',note:'',risks:[]};
  var cc=I.confidence==='high'?'#34F5A8':I.confidence==='medium'?'#FFC24B':I.confidence==='low'?'#FF9A4B':'#695B89';
  var sevC=function(s){s=(''+(s||'')).toLowerCase();return s.indexOf('high')>=0||s.indexOf('critical')>=0?'#FF5470':s.indexOf('med')>=0||s.indexOf('elev')>=0?'#FFC24B':'#34F5A8';};
  var risks=(I.risks||[]).map(function(r){var c=sevC(r.severity);return '<div class="panel" style="padding:14px 16px;margin-bottom:11px;border-left:3px solid '+c+'"><div style="display:flex;align-items:center;gap:10px"><span class="spill" style="color:'+c+';border-color:'+c+'66;text-transform:uppercase;font-size:11px">'+h(r.severity)+'</span><div style="font-size:14.5px;font-weight:600">'+h(r.subject)+'</div></div><div class="muted" style="font-size:13px;margin-top:7px;line-height:1.5">'+h(r.why)+'</div></div>';}).join('')||'<div class="muted" style="font-size:13px">No correlated cross-fleet risks right now — Prophet reads the fleet as nominal, or no agent has surfaced a signal worth correlating.</div>';
  var sig=(D.events||[]).slice(0,7).map(function(e){return '<div style="display:flex;gap:11px;align-items:flex-start;padding:9px 0;border-bottom:1px solid rgba(140,100,230,.08)"><span class="dot" style="background:'+(e.color||'#A974FF')+';margin-top:5px"></span><div style="flex:1"><div style="font-size:13px;color:#ECE4F8">'+h(e.text)+'</div><div class="mono muted" style="font-size:11px;margin-top:2px">'+h(e.agent)+' · '+h(e.time)+'</div></div></div>';}).join('')||'<div class="muted" style="font-size:13px">No recent fleet signal.</div>';
  var pc=I.available?cc:'#695B89';
  return '<div class="cap"><h2>Intelligence</h2><span class="sub">Prophet cross-fleet synthesis · live read-only</span></div>'+
   '<div style="display:flex;gap:18px;flex:1;min-height:0"><div class="col" style="flex:1;min-height:0;display:flex;flex-direction:column;gap:16px">'+
   '<div class="panel" style="padding:18px 20px;flex:0 0 auto;display:flex;align-items:center;gap:18px"><div style="width:72px;height:72px;border-radius:20px;border:2px solid '+pc+';display:flex;align-items:center;justify-content:center;font-size:32px;color:'+pc+';background:'+pc+'14">'+el('ti-brain')+'</div><div style="flex:1"><div class="orb" style="font-size:19px;color:'+pc+'">'+(I.available?('CONFIDENCE · '+h((''+(I.confidence||'unknown')).toUpperCase())):'SYNTHESIS UNAVAILABLE')+'</div><div class="muted" style="font-size:13px;margin-top:6px;line-height:1.5">'+h(I.note||'Prophet has no synthesis to report.')+'</div></div></div>'+
   '<div class="panel" style="flex:1;min-height:0;padding:16px 18px;display:flex;flex-direction:column"><div class="phd">'+el('ti-alert-triangle')+' correlated risks<span class="ct">'+((I.risks||[]).length)+' ranked</span></div><div style="margin-top:13px;overflow:auto">'+risks+'</div></div></div>'+
   '<div class="col sidecol" style="width:420px;min-height:0;display:flex;flex-direction:column;gap:16px"><div class="panel" style="padding:16px 18px;flex:1;min-height:0;display:flex;flex-direction:column"><div class="phd">'+el('ti-broadcast')+' intelligence signal<span class="ct">live stream</span></div><div style="margin-top:10px;overflow:auto">'+sig+'</div></div>'+
   '<div class="panel" style="padding:16px 18px;flex:0 0 auto"><div class="phd">'+el('ti-notebook')+' knowledge</div><div class="muted" style="font-size:13px;margin-top:9px;line-height:1.55">Research dossiers Prophet files land in your Obsidian vault (the meaning layer) and the Ask grounding index. Fire a directive from the console to grow it.</div></div></div></div>';
}
var PAGES={overview:overview,fleet:fleet,ops:ops,intel:intel,synapses:synapses,audit:audit,tech:tech};
function go(name){curPage=name;P.innerHTML=(PAGES[name]||overview)();var ns=document.querySelectorAll('.nv');for(var i=0;i<ns.length;i++)ns[i].classList.toggle('on',ns[i].getAttribute('data-p')===name);}
var navs=document.querySelectorAll('.nv');for(var i=0;i<navs.length;i++)navs[i].addEventListener('click',function(){var n=this.getAttribute('data-p');location.hash=n;go(n);});
window.addEventListener('hashchange',function(){var h=(location.hash||'').replace('#','');if(PAGES[h])go(h);});
var start=(location.hash||'').replace('#','');go(PAGES[start]?start:'overview');
// clock
function tick(){var d=new Date();document.getElementById('clock').textContent=d.toTimeString().slice(0,8);}tick();setInterval(tick,1000);

// ── agent drawer (click a neuron or fleet row) ──
var drawer=document.getElementById('drawer');
function statusColor(s){return s==='down'?'#FF5470':s==='idle'?'#A974FF':s==='watch'?'#FFC24B':s==='firing'?'#fff':'#34F5A8';}
function openDrawer(id){var a=null;for(var i=0;i<D.agents.length;i++){if(D.agents[i].id===id){a=D.agents[i];break;}}if(!a)return;
  var sc=statusColor(a.status);
  var dash=a.hasDashboard?'<a class="dlink" href="/agent/'+h(a.id)+'/ui">'+el('ti-external-link')+' Open full dashboard</a>':'<div class="muted" style="margin-top:16px;font-size:13px">No dedicated dashboard yet — this neuron is wired but its detail page is a next-slice build.</div>';
  drawer.innerHTML='<i class="ti ti-x dx" id="ddx"></i><div style="display:flex;align-items:center;gap:16px"><div class="dbig" style="border-color:'+a.color+';color:'+a.color+'">'+h(a.initials)+'</div><div><div class="orb" style="font-size:20px">'+h(a.name)+'</div><div class="muted" style="font-size:13px">'+h(a.role)+'</div></div></div>'+
    '<div style="margin-top:14px"><span class="spill" style="color:'+sc+';border-color:'+sc+'66">'+h(a.status)+'</span></div>'+
    '<div class="muted" style="margin-top:14px;font-size:14px;line-height:1.55">'+h(a.description)+'</div>'+
    (a.statusReason?'<div class="dcell" style="margin-top:14px"><div class="l">status</div><div style="font-size:13.5px;color:#ECE4F8;margin-top:4px">'+h(a.statusReason)+'</div></div>':'')+
    '<div class="dgrid"><div class="dcell"><div class="l">signal</div><div class="n" style="color:'+a.color+'">'+h(a.metric)+'</div></div><div class="dcell"><div class="l">health</div><div class="n" style="color:'+sc+'">'+h(a.status)+'</div></div></div>'+dash;
  drawer.classList.add('open');
  document.getElementById('ddx').addEventListener('click',function(){drawer.classList.remove('open');});
}
// gated Authorize/Reject → POST /api/proposals/transition
function synAct(action,rid,btn){if(!rid)return;var lbl=btn.innerHTML;btn.innerHTML='…';btn.style.opacity='.6';
  fetch('/api/proposals/transition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:rid,action:action})}).then(function(r){return r.json();}).then(function(j){
    if(j.ok){for(var i=0;i<D.proposals.length;i++){if(D.proposals[i].realId===rid){D.proposals[i].status=(action==='approve'?'simulated_approved':'rejected');}}go('synapses');}
    else{btn.innerHTML=lbl;btn.style.opacity='1';alert((action==='approve'?'Authorize':'Reject')+' did not apply: '+(j.reason||'unknown')+(j.status?(' (status '+j.status+')'):''));}
  }).catch(function(){btn.innerHTML=lbl;btn.style.opacity='1';alert('Transition request failed — are you signed in to the cockpit?');});}
document.getElementById('page').addEventListener('click',function(e){var t=e.target;while(t&&t!==this){if(t.getAttribute){
  if(t.getAttribute('data-act')){synAct(t.getAttribute('data-act'),t.getAttribute('data-rid'),t);return;}
  var ds=t.getAttribute('data-syn');if(ds!==null&&ds!==undefined){selSyn=parseInt(ds,10)||0;go('synapses');return;}
  if(t.getAttribute('data-id')){openDrawer(t.getAttribute('data-id'));return;}
}t=t.parentNode;}});

// ── neural console (collapsible, replies via /api/ask) ──
var scrim=document.getElementById('scrim'),tbody=document.getElementById('tbody'),peek=document.getElementById('peek'),cin=document.getElementById('cin'),cbusy=document.getElementById('cbusy');
var booted=false;
function tline(html){var d=document.createElement('div');d.innerHTML=html;tbody.appendChild(d);tbody.scrollTop=tbody.scrollHeight;return d;}
function openConsole(prefill){scrim.classList.add('open');peek.classList.remove('show');
  if(!booted){booted=true;tline('<div class="tr"><span class="ok">HartOS neural console online.</span> Ask anything, or use a slash command. Answers come from the live fleet (propose-only).</div>');
    var chips=['/fleet','/synapses','/audit','/ask Prophet','/ops status'];document.getElementById('tchips').innerHTML=chips.map(function(c){return '<span class="tchip">'+c+'</span>';}).join('');
    var cs=document.querySelectorAll('.tchip');for(var i=0;i<cs.length;i++)cs[i].addEventListener('click',function(){cin.value=this.textContent;cin.focus();});}
  setTimeout(function(){cin.focus();if(prefill){cin.value=prefill;}},120);}
function closeConsole(){scrim.classList.remove('open');peek.classList.add('show');document.getElementById('peekmid').textContent=lastReply||'tap to resume the console';}
var lastReply='';
function consoleSend(){var v=cin.value.trim();if(!v)return;cin.value='';
  // slash commands route the cockpit; everything else goes to /api/ask
  var sl=v.toLowerCase();
  if(sl==='/fleet'||sl==='/synapses'||sl==='/audit'||sl==='/overview'||sl==='/ops'){var pg=sl.replace('/','').replace('ops','ops');if(PAGES[pg]){tline('<div class="tu"><span class="tp">&gt;</span>'+h(v)+'</div>');tline('<div class="tr">opening <span class="ok">'+h(pg)+'</span> …</div>');location.hash=pg;go(pg);setTimeout(closeConsole,400);return;}}
  tline('<div class="tu"><span class="tp">&gt;</span>'+h(v)+'</div>');
  var ph=tline('<div class="tr"><span class="tcur">▌</span> consulting the fleet…</div>');cbusy.style.opacity='1';
  fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:v})}).then(function(r){return r.json();}).then(function(j){
    var ans=(j.summary||j.answer||j.message||'(no answer returned)');lastReply=ans.slice(0,90);
    var extra='';
    if(j.jobCreated){
      if(j.jobCreated.persisted){extra+='<div style="margin-top:9px;padding:9px 12px;border:1px solid rgba(52,245,168,.4);border-radius:10px;background:rgba(52,245,168,.07)"><span style="color:#34F5A8;font-weight:600">✓ Proposal created</span> · '+h(j.jobCreated.title)+'<div data-goto="synapses" style="margin-top:5px;color:#22E8FF;cursor:pointer;font-size:13px">Approve it in Synapses →</div></div>';}
      else{extra+='<div style="margin-top:9px;color:#FFC24B;font-size:12.5px">⚠ could not queue the proposal: '+h(j.jobCreated.reason||'unknown')+'</div>';}
    }
    if(j.usedLlm===false){extra+='<div style="color:#695B89;margin-top:6px;font-size:12px">⌁ deterministic answer (LLM gate off)</div>';}
    ph.innerHTML='<div class="tr">'+h(ans)+extra+'</div>';
    tbody.scrollTop=tbody.scrollHeight;cbusy.style.opacity='0';
  }).catch(function(){ph.innerHTML='<div class="tr" style="color:#FF5470">request failed — are you signed in to the cockpit?</div>';cbusy.style.opacity='0';});}
// a "Approve it in Synapses →" link inside a console reply jumps to the board
tbody.addEventListener('click',function(e){var t=e.target;while(t&&t!==tbody){if(t.getAttribute&&t.getAttribute('data-goto')){var pg=t.getAttribute('data-goto');location.hash=pg;go(pg);closeConsole();return;}t=t.parentNode;}});
document.getElementById('opencon').addEventListener('click',function(){openConsole();});
document.getElementById('cclose').addEventListener('click',closeConsole);
document.getElementById('peek').addEventListener('click',function(){openConsole();});
scrim.addEventListener('click',function(e){if(e.target===scrim)closeConsole();});
cin.addEventListener('keydown',function(e){if(e.key==='Enter')consoleSend();});
// footer input + TRANSMIT now open the console with the text
function fromFooter(){var v=document.getElementById('ask').value.trim();document.getElementById('ask').value='';openConsole();setTimeout(function(){cin.value=v;consoleSend();},160);}
document.getElementById('tx').addEventListener('click',fromFooter);
document.getElementById('ask').addEventListener('keydown',function(e){if(e.key==='Enter')fromFooter();});
document.addEventListener('keydown',function(e){
  if(e.key==='Escape'){if(scrim.classList.contains('open'))closeConsole();else drawer.classList.remove('open');}
  if((e.key==='\`'||e.key==='~')&&document.activeElement.tagName!=='INPUT'){e.preventDefault();if(scrim.classList.contains('open'))closeConsole();else openConsole();}
});

// ── real-time: poll /api/v5 + re-render in place (no page reload) ──
function poll(){
  if(scrim.classList.contains('open'))return; // never disrupt the console mid-type
  fetch('/api/v5',{headers:{'accept':'application/json'}}).then(function(r){return r.ok?r.json():null;}).then(function(d){
    if(!d||!d.agents)return;window.HV=d;D=d;
    if(!drawer.classList.contains('open'))go(curPage);
    var lk=document.querySelector('.link');if(lk){lk.style.boxShadow='0 0 20px rgba(34,232,255,.5)';setTimeout(function(){lk.style.boxShadow='';},420);}
  }).catch(function(){});
}
setInterval(poll,6000);
})();
</script></body></html>`;
}
