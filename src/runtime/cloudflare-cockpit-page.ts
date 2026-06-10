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
  cockpitSuggestions,
  type ReadModelStatusView,
  type ProposalsView,
  type FleetView,
} from "./cloudflare-cockpit-views.js";
import { mutationCenterView, type MutationCenterView } from "./views/mutation-center-view.js";
import { fleetBriefingView, type FleetBrainView } from "./views/fleet-brain-view.js";
import { mutationDispatchView, type MutationDispatchView } from "./views/mutation-dispatch-view.js";
import { voiceInputButtonHtml, voiceInputClientScript } from "./views/voice-input.js";
import { fleetSynthesisView, type FleetSynthesisView } from "./views/fleet-synthesis-view.js";
import { autonomyPreviewView, type AutonomyPreviewView } from "./views/autonomy-preview-view.js";
import { factoryJobView, type FactoryJobView } from "./views/factory-job-view.js";
import { auditTailView, type AuditTailView } from "./views/audit-tail-view.js";
import { auditRowsFromProposals } from "./views/audit-from-proposals.js";
import type { FreshnessReport } from "../cockpit/freshness-surface.js";
import { ACTION_EXECUTION } from "./cloudflare-security.js";
import type { AgentDetail, FitnessDetail, OpsDetail } from "../read-models/agent-detail.js";
import type { GenericAgentDetail, DetailSection } from "../read-models/agent-detail-registry.js";
import type { CockpitThreadSummary } from "../cockpit/threads/cockpit-thread-spine.js";
import { perceive, type PerceptionReport } from "../rinnegan/perception.js";
import { collectFleetTasks, assessFleetLoad, type FleetWork } from "../fleet/fleet-work.js";
import { orchestrateFleet, type FleetPlan } from "../fleet/orchestrator.js";
import { forecast, type ForecastReport } from "../prophet/forecast.js";
import { coach, type CoachingSignals } from "../fitness/coaching-core.js";
import { triageOps, type OpsSignals } from "../ops/triage-core.js";
import type { SuggestionSet } from "../cockpit/suggestions/suggest-actions.js";
import { strategicAwareness, type StrategicBrief } from "../awareness/strategic-awareness.js";
import { executiveMemory, type ExecutiveMemoryReport, type MemorySnapshot } from "../awareness/executive-memory.js";
import type { KnowledgeSurface } from "../cockpit/knowledge-surface.js";
import { resolveMetaAgentRegistry } from "../agents/meta-agent-registry.js";
import { renderAgentOrgPanel, renderStatusStrip } from "./views/agent-org-view.js";
import { computeStatusSplit } from "../cockpit/status-split.js";

export interface HostedPageOptions {
  runtimeMode?: string;
  generatedAt?: string | null;
  /** ISO now used for freshness; defaults to the snapshot generatedAt. */
  now?: string;
  /** Phase D — recent thread summaries from the spine, for the activity panel. */
  threads?: CockpitThreadSummary[];
  /**
   * Executive Memory seam (Cockpit V2) — a supplied history of compact snapshots. Absent on the
   * stateless hosted path (the memory section then renders the honest INSUFFICIENT_HISTORY line);
   * a future persister populates it and the same render surfaces real patterns/trends/lessons.
   */
  memorySnapshots?: MemorySnapshot[];
  /**
   * Knowledge & Intelligence surface (research/capability dossiers from the context pack + optional
   * Wolverine/Prophet intel). Composed by the Worker from the live pack; absent ⇒ the card renders
   * the honest "nothing filed yet" line.
   */
  knowledge?: KnowledgeSurface;
  /**
   * Runtime diagnostics for the Technical page (secret-free). Surfaces why the LLM did/didn't fire,
   * provider connectivity, vault sync, version — so "no live LLM" is never a silent mystery.
   */
  diagnostics?: {
    providerMode?: string;
    gateReason?: string;
    model?: string;
    apiKeyEffective?: boolean;
    opsStatus?: string;
    opsReason?: string;
    vaultNotesSynced?: number | null;
    version?: string | null;
  };
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
  /* Cockpit V2 — navy-tinted dark (validated by the Light Blue reference; skin only, IA unchanged) */
  --bg:#0B0E16;--panel:#141927;--line:#232A3B;--line2:#1b2231;
  --txt:#E8EBF2;--dim:#9AA3B8;--faint:#5B6479;
  --green:#3FB950;--amber:#D29922;--red:#F85149;--idle:#6E7681;
  --sg:rgba(63,185,80,.14);--sa:rgba(210,153,34,.16);--sb:rgba(91,141,239,.16);--sr:rgba(248,81,73,.16);
  --primary:#5B8DEF;--primaryH:#6f9bf2;--accent:#5B8DEF;--glow:rgba(91,141,239,.18);
  --mono:ui-monospace,SFMono-Regular,"Geist Mono",Menlo,Consolas,monospace;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;
}
body{margin:0;background:linear-gradient(180deg,#0E1220 0,#0B0E16 520px) fixed,#0B0E16;color:var(--txt);font-family:var(--sans);font-size:13.5px;line-height:1.5}
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
.tag.pend{background:var(--sa);color:var(--amber)}.tag.loc{background:var(--sb);color:var(--primary)}.tag.ok{background:var(--sg);color:var(--green)}
.pact{margin-left:8px;display:inline-flex;gap:5px}
.pbtn{font:inherit;font-size:11px;font-weight:700;border:1px solid var(--line);border-radius:6px;padding:2px 8px;cursor:pointer;background:var(--panel)}
.pbtn.ok{color:var(--green);border-color:#bfe6d2}.pbtn.no{color:var(--red);border-color:#f3c9d0}
.pbtn:disabled{opacity:.5;cursor:default}
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
.charts{display:grid;grid-template-columns:repeat(2,1fr);gap:14px;margin-top:4px}
@media(max-width:700px){.charts{grid-template-columns:1fr}}
.chart .ct{font-size:11px;font-weight:700;color:var(--faint);letter-spacing:.3px;text-transform:uppercase;margin-bottom:2px}
svg.spark{display:block;width:100%;height:84px;background:var(--line2);border-radius:8px}
.sparkmeta{font-size:11px;color:var(--faint);margin-top:3px}
.qbtn{margin-top:10px;font:inherit;font-size:12px;font-weight:700;border:1px solid var(--line);background:var(--bg);color:var(--primary);border-radius:8px;padding:6px 12px;cursor:pointer}
.qbtn:disabled{opacity:.6;cursor:default}
.qmsg{font-size:11.5px;margin-left:8px}
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

/* ───────────────────────── Cockpit V2 ───────────────────────── */
.card,.box,.attn,.ask,pre.answer{box-shadow:0 1px 0 rgba(255,255,255,.02),0 8px 24px rgba(0,0,0,.28)}
.card:hover{border-color:#324063;box-shadow:0 10px 30px rgba(0,0,0,.4)}
code,.mono{font-family:var(--mono)}
.app2{display:grid;grid-template-columns:64px 1fr;min-height:100vh}
/* UI v2 — persistent right-side Ask CLI (desktop only; mobile uses the ⌘K palette) */
.askcli{display:none;flex-direction:column;border-left:1px solid var(--line);background:rgba(10,12,20,.6);height:100vh;position:sticky;top:0;padding:14px 12px;gap:10px}
.askcli .aclbl{font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}
.askcli .acin{display:flex;gap:6px}
.askcli input{flex:1;background:#0b0e16;border:1px solid var(--line);border-radius:8px;color:#e6edf3;padding:7px 9px;font-size:12px}
.askcli pre{flex:1;overflow:auto;white-space:pre-wrap;font-size:12px;font-family:ui-monospace,Menlo,Consolas,monospace;background:#0b0e16;border:1px solid var(--line);border-radius:8px;padding:10px;margin:0}
@media(min-width:1280px){.app2{grid-template-columns:64px 1fr 360px}.askcli{display:flex}}
/* icon rail */
.rail{position:sticky;top:0;height:100vh;background:rgba(15,18,30,.7);backdrop-filter:blur(8px);border-right:1px solid var(--line);display:flex;flex-direction:column;align-items:center;gap:6px;padding:14px 0}
.rail .mk{width:34px;height:34px;border-radius:10px;background:linear-gradient(135deg,#5B8DEF,#7C5CFF);display:grid;place-items:center;color:#fff;font-size:15px;margin-bottom:10px;box-shadow:0 0 18px var(--glow)}
.rb{position:relative;width:42px;height:42px;border-radius:11px;display:grid;place-items:center;color:var(--dim);font-size:17px;cursor:pointer;border:1px solid transparent;transition:background .12s,color .12s,border-color .12s}
.rb:hover{background:var(--bg-elev-2,#1A2030);color:var(--txt)}
.rb.active{background:var(--sb);color:var(--primary);border-color:#2c3f66}
.rb .lbl{position:absolute;left:52px;white-space:nowrap;background:#1A2030;border:1px solid var(--line);color:var(--txt);font-size:12px;font-weight:600;padding:4px 9px;border-radius:7px;opacity:0;pointer-events:none;transform:translateX(-4px);transition:opacity .12s,transform .12s;z-index:30}
.rb:hover .lbl{opacity:1;transform:translateX(0)}
.rb .cnt{position:absolute;top:5px;right:5px;min-width:15px;height:15px;border-radius:8px;background:var(--red);color:#fff;font-size:9px;font-weight:800;display:grid;place-items:center;padding:0 3px}
.rail .sp{flex:1}
.rail .av{width:30px;height:30px;border-radius:50%;background:#222b40;display:grid;place-items:center;font-weight:700;color:#9fb0cc;font-size:12px}
/* topbar */
.tb{display:flex;align-items:center;gap:12px;padding:14px 26px;border-bottom:1px solid var(--line);position:sticky;top:0;background:rgba(11,14,22,.72);backdrop-filter:blur(10px);z-index:20}
.cmd{flex:1;max-width:560px;display:flex;align-items:center;gap:9px;background:var(--panel);border:1px solid var(--line);border-radius:10px;padding:8px 12px;color:var(--faint);cursor:text}
.cmd:focus-within{border-color:var(--primary);box-shadow:0 0 0 3px var(--glow)}
.cmd input{flex:1;border:none;outline:none;background:transparent;font:inherit;color:var(--txt)}
.tstamp{color:var(--faint);font-size:12px;font-family:var(--mono)}
.wrap{padding:22px 26px;max-width:1200px;margin:0 auto}
/* section + view system */
.view[hidden]{display:none}
.seclbl{display:flex;align-items:center;gap:8px;font-size:11px;letter-spacing:1.3px;color:var(--faint);text-transform:uppercase;font-weight:800;margin:22px 2px 11px}
.seclbl .ln{flex:1;height:1px;background:var(--line)}
/* executive brief hero */
.hero{display:grid;grid-template-columns:2fr 1fr;gap:14px}
.htile{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:16px 18px;position:relative;overflow:hidden}
.htile.lead{background:linear-gradient(135deg,rgba(91,141,239,.10),rgba(124,92,255,.04)),var(--panel);border-color:#2c3f66;box-shadow:0 0 0 1px var(--glow),0 10px 30px rgba(0,0,0,.3)}
.htile .k{font-size:10px;letter-spacing:1px;text-transform:uppercase;color:var(--faint);font-weight:800;margin-bottom:7px}
.htile .v{font-size:15px;font-weight:700;line-height:1.4}
.htile .vbig{font-size:20px;font-weight:800;letter-spacing:-.3px;line-height:1.3}
.htile .sub2{color:var(--dim);font-size:12px;margin-top:5px}
.htile .hist{font-family:var(--mono);font-size:11px;color:var(--amber);margin-top:6px}
.htile .bar{position:absolute;left:0;top:0;bottom:0;width:3px}
.htile.r .bar{background:var(--red)}.htile.a .bar{background:var(--amber)}.htile.g .bar{background:var(--green)}.htile.i .bar{background:var(--idle)}
.hero4{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:14px}
.sysv{display:grid;place-items:center;text-align:center}
.sysv .big{font-size:26px;font-weight:800;letter-spacing:-.5px}
.hbtns{display:flex;gap:8px;margin-top:10px}
/* awareness / memory / focus columns */
.cols{display:grid;grid-template-columns:repeat(4,1fr);gap:14px}
.cols2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.awli{display:flex;gap:8px;align-items:flex-start;padding:7px 0;font-size:12.5px;color:var(--dim);border-top:1px solid var(--line2)}
.awli:first-child{border-top:none}
.awli b{color:var(--txt);font-weight:600}
.frq{font-family:var(--mono);font-size:11px;color:var(--faint);margin-left:auto;white-space:nowrap}
.spark{display:flex;align-items:flex-end;gap:2px;height:18px}
.spark i{width:5px;background:var(--primary);border-radius:1px;opacity:.8}
.lesson{font-style:italic;color:var(--txt);font-size:12.5px;padding:7px 0;border-top:1px solid var(--line2)}
.fcol .h{font-size:11px;font-weight:800;letter-spacing:.6px;text-transform:uppercase;color:var(--faint);margin-bottom:6px}
/* mobile bottom nav */
.botnav{display:none}
@media(max-width:760px){
  .app2{grid-template-columns:1fr}
  .rail{display:none}
  .tb{padding:12px 16px}
  .wrap{padding:16px 16px 80px}
  .hero{grid-template-columns:1fr}.hero .focus{grid-column:auto}
  .hero4{grid-template-columns:1fr 1fr}
  .cols{grid-template-columns:1fr}.cols2{grid-template-columns:1fr}
  .grid4{grid-template-columns:1fr 1fr}
  .botnav{display:flex;position:fixed;left:0;right:0;bottom:0;z-index:40;background:rgba(15,18,30,.94);backdrop-filter:blur(10px);border-top:1px solid var(--line);padding:8px 6px;justify-content:space-around}
  .bn{position:relative;display:flex;flex-direction:column;align-items:center;gap:2px;color:var(--faint);font-size:10px;font-weight:700;padding:4px 12px;border-radius:10px;cursor:pointer}
  .bn.active{color:var(--primary);background:var(--sb)}
  .bn .cnt{position:absolute;top:0;right:8px;min-width:14px;height:14px;border-radius:7px;background:var(--red);color:#fff;font-size:8px;display:grid;place-items:center}
}
@media(prefers-reduced-motion:no-preference){
  .view:not([hidden])>*{animation:rise .14s ease both}
  @keyframes rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
  .dot.r{animation:pulse 1.6s ease-in-out infinite}
  @keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(248,81,73,.5)}50%{box-shadow:0 0 0 4px rgba(248,81,73,0)}}
}
.login-card input,.x{background:#0f1320}
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

/** The agent's headline coaching/triage call, read from the baked panel (same snapshot). */
function panelAdvice(state: CockpitState | undefined, domain: string): { text: string; confidence: string } | null {
  const panel = state?.panels?.find((p) => p.id === domain);
  if (!panel) return null;
  const key = domain === "fitness" ? "adjustment" : domain === "ops" ? "next_action" : "";
  const f = key ? panel.fields.find((x) => x.key === key) : undefined;
  if (!f || f.status !== "ok") return null;
  return { text: f.value, confidence: f.confidence ?? "low" };
}

function fleetCard(agent: FleetView["agents"][number], advice?: { text: string; confidence: string } | null): string {
  const s = agent.signal;
  const t = tone(s.verdict, s.confidence, s.freshness);
  const metrics = s.facts
    .filter((f) => f.key !== "read_status" && f.key !== "degraded_source" && f.value !== null && f.value !== "")
    .slice(0, 3);
  const factsHtml = metrics.length
    ? metrics.map((f) => `<span><b>${esc(String(f.value))}</b> ${esc(prettyKey(f.key))}</span>`).join("")
    : `<span class="muted">no metrics resolved</span>`;
  const confClass = s.confidence === "high" ? "high" : "low";
  // The coach/triage headline (fitness → coaching call, ops → top triage action).
  const adviceHtml = advice
    ? `<div class="sum" style="margin-top:6px"><b>▸</b> ${esc(advice.text)} <span class="tag">${esc(advice.confidence)}</span></div>`
    : "";
  return (
    `<a class="card" href="/agent/${esc(agent.type)}/ui" data-agent="${esc(agent.type)}">` +
    `<div class="ctop"><span class="ico">${agentIcon(agent.type)}</span><span class="cname">${esc(titleCase(agent.type))}</span>` +
    `<span class="vpill ${t}">${esc(String(s.verdict).toUpperCase())}</span></div>` +
    `<div class="cstat">${esc(s.freshness)}${s.approvalNeeded ? " · approval-gated" : ""}</div>` +
    `<div class="facts">${factsHtml}</div>` +
    `<div class="sum">${esc(s.reason)}</div>` +
    adviceHtml +
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
  // Hygiene banner — honest, view-only. The durable expiry/dedup stays an explicit command
  // (the Worker holds no DB key); we surface the counts + the exact command to apply them.
  const hygieneBits: string[] = [];
  if (props.duplicates > 0) hygieneBits.push(`${props.duplicates} duplicate`);
  if (props.staleExpired > 0) hygieneBits.push(`${props.staleExpired} past-expiry`);
  const hygiene = hygieneBits.length
    ? `<div class="muted" style="margin-top:6px">Hygiene: ${esc(hygieneBits.join(" · "))} — ask "expire duplicate proposals" to clean the queue.</div>`
    : "";
  const head = `<div class="li"><b>${props.total}</b>&nbsp;total${props.pending ? ` · ${props.pending} pending` : ""}</div>`;
  const rows = props.proposals
    .slice(0, 6)
    .map((p) => {
      const pending = p.status === "pending_approval" || p.status === "draft";
      const tg = p.staleExpired || p.duplicate ? "pend" : pending ? "pend" : "ok";
      const label = p.staleExpired
        ? "past expiry"
        : p.duplicate
          ? "duplicate"
          : p.status === "pending_approval"
            ? "needs approval"
            : p.status;
      const riskTag = `<span class="tag">${esc(p.riskLevel)} risk</span>`;
      // Approve/reject only what is pending. The write goes through the gated, capability-
      // token Edge Function (the Worker holds no DB key); the row id is the transition target.
      const actions = p.status === "pending_approval"
        ? `<span class="pact" data-pid="${esc(p.id)}"><button class="pbtn ok" data-act="approve">Approve</button><button class="pbtn no" data-act="reject">Reject</button></span>`
        : "";
      // Decision reasoning — what it does + why approve / why reject. Dimmed for resolved/dup/stale.
      const reasoning = pending
        ? `<div class="muted" style="margin-top:2px">${esc(p.effect)}</div>` +
          `<div class="muted" style="margin-top:2px">✓ Approve: ${esc(p.whyApprove)}</div>` +
          `<div class="muted" style="margin-top:2px">✗ Reject: ${esc(p.whyReject)}</div>`
        : "";
      return `<div class="li" style="${p.staleExpired || p.duplicate ? "opacity:.6" : ""}"><span><b>${esc(p.title)}</b> <span class="tag ${tg}">${esc(label)}</span>${riskTag}${actions}${reasoning}</span></div>`;
    })
    .join("");
  return box("Proposal queue", head + hygiene + rows, "proposals");
}

function mutationCenterBox(view: MutationCenterView): string {
  if (!view.available || view.total === 0) {
    return box("Mutation Center", `<div class="muted">${esc(view.note)}</div>`, "mutation-center");
  }
  const head = `<div class="li"><b>${view.total}</b>&nbsp;pending-executable <span class="tag">read-only</span></div>`;
  const rows = view.rows
    .slice(0, 6)
    .map((r) => {
      const tier = r.tier ? `<span class="tag">${esc(r.tier)}</span>` : `<span class="tag pend">untiered</span>`;
      const refused = r.refusedActions.length ? ` <span class="tag no">${r.refusedActions.length} blocked</span>` : "";
      return `<div class="li">${esc(r.title)} <span class="tag">${esc(r.riskLevel)}</span>${tier}${refused}</div>`;
    })
    .join("");
  return box("Mutation Center", head + rows, "mutation-center");
}

function fleetBrainBox(view: FleetBrainView): string {
  if (!view.available || view.items.length === 0) {
    const note = view.available ? "No fleet briefing items." : view.note;
    return box("Fleet Brain · priority briefing", `<div class="muted">${esc(note)}</div>`, "fleet-brain");
  }
  const rows = view.items
    .slice(0, 6)
    .map(
      (it) =>
        `<div class="li"><b>${esc(it.subject)}</b> <span class="tag">${esc(it.ownerAgent)}</span> <span class="tag">${esc(it.confidence)}/${esc(it.freshness)}</span><div class="muted">${escMultiline(it.why)}</div></div>`
    )
    .join("");
  return box("Fleet Brain · priority briefing", rows, "fleet-brain");
}

function mutationDispatchBox(view: MutationDispatchView): string {
  if (!view.available || view.total === 0) {
    return box("Dispatch readiness", `<div class="muted">${esc(view.note)}</div>`, "mutation-dispatch");
  }
  const head = `<div class="li"><b>${view.ready}</b>&nbsp;of ${view.total} dispatch-ready <span class="tag">read-only</span></div>`;
  const rows = view.rows
    .slice(0, 6)
    .map((r) => {
      const adapter = r.adapterId ? `<span class="tag">${esc(r.adapterId)}</span>` : `<span class="tag pend">no adapter</span>`;
      const ready = r.dispatchReady ? `<span class="tag">ready</span>` : `<span class="tag no">not ready</span>`;
      const cmd = r.mutateCommand ? `<div class="muted"><code>${esc(r.mutateCommand)}</code></div>` : "";
      return `<div class="li">${esc(r.title)} ${adapter}${ready}${cmd}</div>`;
    })
    .join("");
  return box("Dispatch readiness", head + rows, "mutation-dispatch");
}

function fleetSynthesisBox(view: FleetSynthesisView): string {
  if (!view.available) {
    return box("Fleet synthesis · cross-agent risks", `<div class="muted">${esc(view.note)}</div>`, "fleet-synthesis");
  }
  const sevDot = (s: number): Tone => (s >= 3 ? "r" : s === 2 ? "a" : "i");
  const rows = view.topRisks
    .slice(0, 6)
    .map((r) => {
      const sources = r.sources.map((s) => `<span class="tag">${esc(s)}</span>`).join("");
      return `<div class="li"><span class="dot ${sevDot(r.severity)}"></span><span>${esc(r.subject)} ${sources}<span class="tag">${esc(r.confidence)}</span><div class="muted">${escMultiline(r.why)}</div></span></div>`;
    })
    .join("");
  const inner = rows || `<div class="muted">No cross-agent risks synthesized.</div>`;
  const absent = view.coverage.absentSources.length
    ? `<div class="muted" style="margin-top:8px">Reduced coverage — absent: ${esc(view.coverage.absentSources.join(", "))}</div>`
    : "";
  return box("Fleet synthesis · cross-agent risks", inner + absent, "fleet-synthesis");
}

function auditBox(view: AuditTailView): string {
  if (!view.available || view.rows.length === 0) {
    return box("Audit trail", `<div class="muted">${esc(view.note)}</div>`, "audit-tail");
  }
  const rows = view.rows
    .slice(0, 8)
    .map((r) => `<div class="li"><span class="atext">${esc(r.detail)}</span></div>`)
    .join("");
  return box("Audit trail", rows, "audit-tail");
}

function autonomyBox(view: AutonomyPreviewView): string {
  if (!view.available || view.total === 0) {
    return box("Autonomy preview", `<div class="muted">${esc(view.note)}</div>`, "autonomy-preview");
  }
  const head = `<div class="li"><b>${view.total}</b>&nbsp;would-queue <span class="tag">awaiting Hart · loop can't approve</span></div>`;
  const rows = view.proposals
    .slice(0, 6)
    .map(
      (p) =>
        `<div class="li">${esc(p.title)} <span class="tag">${esc(p.status)}</span><span class="tag">approval: ${esc(p.requiredApproval)}</span></div>`,
    )
    .join("");
  return box("Autonomy preview", head + rows, "autonomy-preview");
}

function factoryJobBox(view: FactoryJobView): string {
  if (!view.available) {
    return box("Factory Agent", `<div class="muted">${esc(view.note)}</div>`, "factory-job");
  }
  if (view.total === 0) {
    return box("Factory Agent", `<div class="muted">${esc(view.note)}</div>`, "factory-job");
  }
  const rows = view.jobs
    .slice(0, 5)
    .map((j) =>
      `<div class="li">${esc(j.requestSummary.slice(0, 60))} <span class="tag">${esc(j.status)}</span>${j.readiness ? `<span class="tag pend">${esc(j.readiness)}</span>` : ""}</div>`,
    )
    .join("");
  return box("Factory Agent", `<div class="li"><b>${view.total}</b> job(s) <span class="tag">read-only</span></div>` + rows, "factory-job");
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

/** Perception (Rinnegan) panel — F2 observations + honest blind spots + the routed work (F-depth). */
function perceptionBox(p: PerceptionReport, work: FleetWork): string {
  const t: Tone = p.verdict === "attention" ? "r" : p.verdict === "watch" ? "a" : "g";
  const sevDot = (s: string): Tone => (s === "critical" ? "r" : s === "warn" ? "a" : "i");
  const rows = p.observations
    .slice(0, 5)
    .map((o) => `<div class="li"><span class="dot ${sevDot(o.severity)}"></span>${esc(o.detail)}</div>`)
    .join("");
  const inner = rows || `<div class="muted">Nothing flagged across systems.</div>`;
  const blind = p.blindSpots.length ? `<div class="muted" style="margin-top:8px">Blind spots: ${esc(p.blindSpots.join(", "))}</div>` : "";
  const load = assessFleetLoad(work);
  const byCap = Object.entries(work.byCapability).map(([c, n]) => `${esc(c)} ${n}`).join(" · ");
  const routing = work.open
    ? `<div class="muted" style="margin-top:8px">Routed work: ${work.open} task(s)${byCap ? ` → ${byCap}` : ""}` +
      `${work.gaps.length ? ` · <b style="color:var(--red)">gaps: ${esc(work.gaps.join(", "))}</b>` : ""}` +
      `${load.overloaded.length ? ` · <b style="color:var(--amber)">overloaded: ${esc(load.overloaded.join(", "))}</b>` : ""}</div>`
    : "";
  return box(
    "Perception (Rinnegan)",
    `<div class="kv"><span class="verdict ${t}">${esc(p.verdict.toUpperCase())}</span></div>${inner}${blind}${routing}`,
    "perception",
  );
}

/** Orchestration (Fleet OS — F4) panel: the proposed schedule + honest deferrals. */
function orchestrationBox(plan: FleetPlan): string {
  const t: Tone = plan.verdict === "needs_agent" ? "r" : plan.verdict === "blocked_capacity" ? "a" : plan.verdict === "ready" ? "g" : "i";
  if (!plan.assignments.length && !plan.deferred.length) {
    return box("Orchestration (Fleet OS)", `<div class="kv"><span class="verdict i">IDLE</span></div><div class="muted">No open work to schedule.</div>`, "orchestration");
  }
  const rows = plan.assignments
    .slice(0, 5)
    .map((a) => `<div class="li"><span class="tag">W${a.order}</span><span>${esc(a.agentName)} · ${esc(a.task.title)}</span></div>`)
    .join("");
  const inner = rows || `<div class="muted">Nothing scheduled — everything is deferred.</div>`;
  const load = plan.perAgent.map((a) => `${esc(a.name)} ${a.assigned}/${a.capacity}`).join(" · ");
  const loadLine = load ? `<div class="muted" style="margin-top:8px">Load: ${load}</div>` : "";
  const deferred = plan.deferred.length
    ? `<div class="muted" style="margin-top:8px"><b style="color:var(--${plan.verdict === "needs_agent" ? "red" : "amber"})">${plan.deferred.length} deferred</b>` +
      `${plan.deferred.some((d) => d.reason === "capability_gap") ? " · gap (build an agent)" : ""}` +
      `${plan.deferred.some((d) => d.reason === "capacity") ? " · capacity" : ""}</div>`
    : "";
  const note = plan.reconciliation.length ? `<div class="muted" style="margin-top:8px">${esc(plan.reconciliation[0]!)}</div>` : "";
  return box(
    "Orchestration (Fleet OS)",
    `<div class="kv"><span class="verdict ${t}">${esc(plan.verdict.toUpperCase().replace(/_/g, " "))}</span></div>${inner}${loadLine}${deferred}${note}`,
    "orchestration",
  );
}

/** Suggested actions panel — the cross-system synthesis ("do next"), propose-only. */
function suggestionsBox(s: SuggestionSet): string {
  const pri = (p: string): Tone => (p === "high" ? "r" : p === "medium" ? "a" : "i");
  if (!s.actions.length) return box("Suggested actions", `<div class="muted">${esc(s.note)}</div>`, "suggestions");
  const rows = s.actions
    .map((a) => `<div class="li"><span class="dot ${pri(a.priority)}"></span><span><b>${esc(a.title)}</b><br><span class="muted">${esc(a.rationale)} · via ${esc(a.source)}</span></span></div>`)
    .join("");
  const queue = `<button class="qbtn" id="queue-suggestions">Queue ${s.actions.length} for approval →</button><span class="qmsg muted" id="queue-msg"></span>`;
  return box("Suggested actions", rows + `<div class="muted" style="margin-top:8px">${esc(s.note)}</div>` + queue, "suggestions");
}

/** Forecast (Prophet — F5) panel: the consequence of inaction, projected not fabricated. */
function forecastBox(r: ForecastReport): string {
  const t: Tone = r.verdict === "urgent" ? "r" : r.verdict === "degrading" ? "a" : "g";
  const sevDot = (s: string): Tone => (s === "high" ? "r" : s === "medium" ? "a" : "i");
  const rows = r.consequences
    .slice(0, 5)
    .map((c) => `<div class="li"><span class="dot ${sevDot(c.severity)}"></span><span>${esc(c.projection)} <span class="tag">${esc(c.horizon)}</span></span></div>`)
    .join("");
  const inner = rows || `<div class="muted">No projected consequences of inaction — stable.</div>`;
  const blind = r.blindSpots.length ? `<div class="muted" style="margin-top:8px">Can't foresee: ${esc(r.blindSpots.join(", "))}</div>` : "";
  return box("Forecast (Prophet)", `<div class="kv"><span class="verdict ${t}">${esc(r.verdict.toUpperCase())}</span></div>${inner}${blind}`, "forecast");
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

// ─── Cockpit V2 — shell + executive sections ─────────────────────────────────

/** Humanize an ISO timestamp relative to now ("12 min ago"); falls back to the raw value. */
function relTime(iso: string, now: string): string {
  const t = Date.parse(iso);
  const n = Date.parse(now);
  if (Number.isNaN(t) || Number.isNaN(n) || t > n) return iso || "no snapshot time";
  const m = Math.round((n - t) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

const V2_NAV: Array<[string, string, string]> = [
  ["overview", "▣", "Overview"],
  ["agents", "🤖", "Agent Organisation"],
  ["intelligence", "◬", "Intelligence"],
  ["approvals", "✓", "Approvals"],
  ["technical", "⚙", "Technical"],
];

/** The 64px icon rail (V2 nav). Destinations toggle server-rendered sections client-side. */
function railV2(pending: number): string {
  const items = V2_NAV.map(
    ([key, ic, label], i) =>
      `<div class="rb${i === 0 ? " active" : ""}" data-nav="${key}" role="button" tabindex="0">${ic}` +
      `${key === "approvals" && pending > 0 ? `<span class="cnt">${pending}</span>` : ""}` +
      `<span class="lbl">${esc(label)}</span></div>`,
  ).join("");
  return (
    `<nav class="rail">` +
    `<div class="mk">◆</div>` +
    items +
    `<div class="sp"></div>` +
    `<div class="rb" title="read-only" style="cursor:default">●<span class="lbl">read-only · ${esc(ACTION_EXECUTION)}</span></div>` +
    `<div class="av">H</div>` +
    `</nav>`
  );
}

/** Mobile bottom nav (thumb zone). Mirrors the rail; Health folds under Approvals on mobile. */
function botnav(pending: number): string {
  const items: Array<[string, string, string]> = [
    ["overview", "▣", "Brief"],
    ["awareness", "◬", "Aware"],
    ["fleet", "⬡", "Fleet"],
    ["approvals", "✓", "Approve"],
  ];
  return (
    `<nav class="botnav">` +
    items
      .map(
        ([key, ic, label], i) =>
          `<div class="bn${i === 0 ? " active" : ""}" data-nav="${key}">${ic}` +
          `${key === "approvals" && pending > 0 ? `<span class="cnt">${pending}</span>` : ""}` +
          `<span>${esc(label)}</span></div>`,
      )
      .join("") +
    `</nav>`
  );
}

function awTone(kind: "risk" | "opp" | "drift" | "blind", confidence?: string): Tone {
  if (kind === "opp") return "g";
  if (kind === "blind") return "i";
  if (kind === "drift") return "a";
  return confidence === "high" ? "r" : "a";
}

/** SECTION 1 — Executive Brief hero (the "if Hart reads nothing else" strip). */
function heroSection(brief: StrategicBrief, overall: string, sysTone: Tone, approval: ProposalsView["proposals"][number] | null): string {
  if (brief.status === "insufficient_evidence") {
    return (
      `<div class="hero"><div class="htile lead i"><span class="bar"></span>` +
      `<div class="k">Executive brief</div><div class="vbig">Awareness pending</div>` +
      `<div class="sub2">${esc(brief.note)}</div></div>` +
      `<div class="htile sysv ${sysTone}"><span class="bar"></span><div class="k">System</div><div class="big">${esc(overall.toUpperCase())}</div></div></div>`
    );
  }
  const focus = brief.recommendedFocus ?? "No single focus — the read is clear.";
  const risk = brief.risks[0];
  const opp = brief.opportunities[0];
  const driver = risk ? risk.risk : "no red signals";

  const focusTile =
    `<div class="htile lead"><span class="bar"></span>` +
    `<div class="k">▸ Recommended focus</div><div class="vbig">${escMultiline(focus)}</div>` +
    `<div class="sub2">highest leverage right now</div></div>`;
  const sysTile =
    `<div class="htile sysv ${sysTone}"><span class="bar"></span><div class="k">System</div>` +
    `<div class="big">${esc(overall.toUpperCase())}</div><div class="sub2">${esc(driver)}</div></div>`;
  const riskTile = risk
    ? `<div class="htile ${risk.confidence === "high" ? "r" : "a"}"><span class="bar"></span><div class="k">Top risk</div>` +
      `<div class="v">${esc(risk.risk)}</div>` +
      `${risk.historicalContext ? `<div class="hist">⟲ ${esc(risk.historicalContext)}</div>` : ""}` +
      `<div class="sub2">${esc(risk.suggestedAction)}</div></div>`
    : `<div class="htile g"><span class="bar"></span><div class="k">Top risk</div><div class="v">None above threshold</div></div>`;
  const oppTile = opp
    ? `<div class="htile g"><span class="bar"></span><div class="k">Top opportunity</div>` +
      `<div class="v">${esc(opp.opportunity)}</div><div class="sub2">${esc(opp.suggestedAction)}</div></div>`
    : `<div class="htile i"><span class="bar"></span><div class="k">Top opportunity</div><div class="v">None standing out</div></div>`;
  const apprTile = approval
    ? `<div class="htile a"><span class="bar"></span><div class="k">Top approval</div>` +
      `<div class="v">${esc(approval.title)}</div><div class="sub2">${esc(approval.riskLevel)} risk · ${esc(approval.effect)}</div>` +
      `<div class="hbtns"><span class="pact" data-pid="${esc(approval.id)}"><button class="pbtn ok" data-act="approve">Approve</button><button class="pbtn no" data-act="reject">Reject</button></span></div></div>`
    : `<div class="htile i"><span class="bar"></span><div class="k">Top approval</div><div class="v">Queue clear</div></div>`;

  return `<div class="hero">${focusTile}${sysTile}</div><div class="hero4">${riskTile}${oppTile}${apprTile}</div>`;
}

function awColumn(title: string, kind: "risk" | "opp" | "drift" | "blind", rows: string[]): string {
  const inner = rows.length ? rows.join("") : `<div class="awli"><span class="muted">None above threshold.</span></div>`;
  return `<div class="box"><div class="blbl">${esc(title)}</div>${inner}</div>`;
}

/** SECTION 2 — Strategic Awareness (Risks / Opportunities / Drift / Blind Spots, capped). */
function awarenessSection(brief: StrategicBrief): string {
  if (brief.status === "insufficient_evidence") {
    return `<div class="box"><div class="muted">${esc(brief.note)}</div></div>`;
  }
  const risk = (r: StrategicBrief["risks"][number]): string =>
    `<div class="awli"><span class="dot ${awTone("risk", r.confidence)}"></span><span><b>${esc(r.risk)}</b>` +
    `${r.historicalContext ? ` <span class="frq">⟲ ${esc(r.historicalContext)}</span>` : ""}<br><span class="muted">${esc(r.suggestedAction)}</span></span></div>`;
  const opp = (o: StrategicBrief["opportunities"][number]): string =>
    `<div class="awli"><span class="dot g"></span><span><b>${esc(o.opportunity)}</b><br><span class="muted">${esc(o.suggestedAction)}</span></span></div>`;
  const dr = (d: StrategicBrief["drift"][number]): string =>
    `<div class="awli"><span class="dot a"></span><span><b>${esc(d.drift)}</b><br><span class="muted">${esc(d.suggestedCorrection)}</span></span></div>`;
  const bs = (b: StrategicBrief["blindSpots"][number]): string =>
    `<div class="awli"><span class="dot i"></span><span>${esc(b.blindSpot)}</span></div>`;
  return (
    `<div class="cols">` +
    awColumn(`Risks (${brief.risks.length})`, "risk", brief.risks.map(risk)) +
    awColumn(`Opportunities (${brief.opportunities.length})`, "opp", brief.opportunities.map(opp)) +
    awColumn(`Drift (${brief.drift.length})`, "drift", brief.drift.map(dr)) +
    awColumn(`Blind spots (${brief.blindSpots.length})`, "blind", brief.blindSpots.map(bs)) +
    `</div>`
  );
}

/** SECTION 3 — Executive Memory (patterns / trends / lessons). Honest INSUFFICIENT_HISTORY. */
function memorySection(mem: ExecutiveMemoryReport): string {
  if (mem.status === "insufficient_history") {
    return `<div class="box"><div class="blbl">Executive memory</div><div class="muted">${esc(mem.note)}</div></div>`;
  }
  const patterns = mem.recurringPatterns.length
    ? mem.recurringPatterns.map((p) => `<div class="awli"><span class="dot ${p.kind === "opportunity" ? "g" : "a"}"></span><b>${esc(p.subject)}</b><span class="frq">${p.occurrences}× / ${Math.round(p.windowDays)}d</span></div>`).join("")
    : `<div class="awli"><span class="muted">No recurring pattern yet.</span></div>`;
  const trends = mem.trends.length
    ? mem.trends.map((t) => `<div class="awli"><span>${esc(t.metric)}</span><span class="frq">${t.from}→${t.to} ${t.direction === "rising" ? "↗" : t.direction === "falling" ? "↘" : "→"}</span></div>`).join("")
    : `<div class="awli"><span class="muted">No trend with enough points.</span></div>`;
  const lessons = mem.lessons.length
    ? mem.lessons.map((l) => `<div class="lesson">“${esc(l.lesson)}”</div>`).join("")
    : `<div class="muted">No evidence-based lesson yet.</div>`;
  return (
    `<div class="cols2">` +
    `<div class="box"><div class="blbl">Recurring patterns</div>${patterns}</div>` +
    `<div class="box"><div class="blbl">Trend summary</div>${trends}</div>` +
    `</div><div class="box" style="margin-top:14px"><div class="blbl">Lessons learned</div>${lessons}</div>`
  );
}

/** SECTION 4 — Today's Focus (Do Now / Can Wait), from the cross-system synthesis. */
function focusSection(s: SuggestionSet): string {
  if (!s.actions.length) return `<div class="box"><div class="muted">${esc(s.note)}</div></div>`;
  const doNow = s.actions.filter((a) => a.priority === "high" || a.priority === "medium");
  const canWait = s.actions.filter((a) => a.priority === "low");
  const row = (a: SuggestionSet["actions"][number], i: number): string =>
    `<div class="awli"><span class="rk now" style="width:20px;height:20px;font-size:11px">${i + 1}</span><span><b>${esc(a.title)}</b><br><span class="muted">${esc(a.rationale)}</span></span></div>`;
  const wait = (a: SuggestionSet["actions"][number]): string =>
    `<div class="awli"><span class="dot i"></span><span>${esc(a.title)} <span class="muted">· ${esc(a.priority)}</span></span></div>`;
  return (
    `<div class="cols2">` +
    `<div class="box"><div class="fcol"><div class="h">Do now</div></div>${doNow.length ? doNow.map(row).join("") : `<div class="muted">Nothing urgent.</div>`}</div>` +
    `<div class="box"><div class="fcol"><div class="h">Can wait</div></div>${canWait.length ? canWait.map(wait).join("") : `<div class="muted">Nothing deferred.</div>`}</div>` +
    `</div>`
  );
}

function sec(label: string): string {
  return `<div class="seclbl">${esc(label)}<span class="ln"></span></div>`;
}
function viewBlock(name: string, visible: boolean, inner: string): string {
  return `<section class="view" data-view="${name}"${visible ? "" : " hidden"}>${inner}</section>`;
}

/** The authed landing cockpit. Grounded, read-only, server-rendered. */
/** The Knowledge & Intelligence card — dossiers + capability scouts (+ optional immune/forecast intel). */
function knowledgeBox(k?: KnowledgeSurface): string {
  if (!k || (k.dossierCount === 0 && k.capabilityScoutCount === 0)) {
    return `<section class="box"><div class="blbl">Knowledge &amp; Intelligence</div><div class="muted">Nothing filed yet — run a research job or a Beezulbub hunt to populate the vault.</div></section>`;
  }
  const types = Object.entries(k.byType).map(([t, n]) => `${esc(t)}: ${n}`).join(" · ");
  const recent = k.recent
    .map(
      (d) =>
        `<li>${esc(d.title)}${d.confidence ? ` <span class="muted">[${esc(String(d.confidence))}]</span>` : ""}` +
        `${d.day ? ` <span class="muted">(${esc(String(d.day))})</span>` : ""}</li>`,
    )
    .join("");
  const scouts = k.capabilityScoutCount
    ? `<p class="kv">Capability scouts <b>${k.capabilityScoutCount}</b>${k.riskyScoutCount ? ` · <b>${k.riskyScoutCount}</b> with a risky/stale top pick` : ""}</p>`
    : "";
  const intelLines: string[] = [];
  if (k.intel.wolverineVerdict) intelLines.push(`Immune <b>${esc(k.intel.wolverineVerdict)}</b> (${k.intel.wolverineFindingCount ?? 0})`);
  if (k.intel.forecastVerdict) intelLines.push(`Forecast <b>${esc(k.intel.forecastVerdict.toUpperCase())}</b>`);
  const intel = intelLines.length ? `<p class="kv">${intelLines.join(" · ")}</p>` : "";
  return (
    `<section class="box"><div class="blbl">Knowledge &amp; Intelligence</div>` +
    `<div class="muted">${esc(k.headline)}</div>` +
    `<p class="kv">Dossiers <b>${k.dossierCount}</b> — ${types}</p>` +
    (recent ? `<ul>${recent}</ul>` : "") +
    scouts +
    intel +
    `</section>`
  );
}

/** A compact Approval Queue summary card for the Overview (counts only; the Approvals page decides). */
function approvalSummaryBox(p: ProposalsView): string {
  if (!p.available) return `<section class="box"><div class="blbl">Approval Queue</div><div class="muted">No proposal queue resolved.</div></section>`;
  const total = p.proposals.length;
  const drafts = p.proposals.filter((x) => x.status === "draft").length;
  return (
    `<section class="box"><div class="blbl">Approval Queue</div>` +
    `<p class="kv">Pending <b>${p.pending}</b> · Total <b>${total}</b>${drafts ? ` · Drafts <b>${drafts}</b>` : ""}</p>` +
    `<div class="muted" style="font-size:11px">Open Approvals to decide — nothing executes without your approval.</div></section>`
  );
}

/** Runtime diagnostics card (Technical page) — why the LLM did/didn't fire, providers, sync, version. Secret-free. */
function diagnosticsBox(d?: HostedPageOptions["diagnostics"]): string {
  if (!d) return `<section class="box"><div class="blbl">Runtime Diagnostics</div><div class="muted">Diagnostics not supplied (rendered without a live env).</div></section>`;
  const row = (k: string, v: string) => `<div class="li"><span>${esc(k)}</span><b style="margin-left:auto">${esc(v)}</b></div>`;
  return (
    `<section class="box"><div class="blbl">Runtime Diagnostics</div>` +
    row("LLM provider mode", d.providerMode ?? "—") +
    row("LLM gate", d.gateReason ?? "—") +
    (d.model ? row("Model", d.model) : "") +
    row("OPENAI_API_KEY effective", d.apiKeyEffective ? "yes (value redacted)" : "no") +
    (d.opsStatus ? row("Ops provider", `${d.opsStatus}${d.opsReason ? ` — ${d.opsReason}` : ""}`) : "") +
    (d.vaultNotesSynced != null ? row("Vault notes synced", String(d.vaultNotesSynced)) : "") +
    (d.version ? row("Version", d.version) : "") +
    `<div class="muted" style="font-size:11px;margin-top:6px">Per-Ask live-LLM / selected-agent / fallback-reason appear in the Ask panel after a query.</div>` +
    `</section>`
  );
}

export function renderHostedCockpitPage(state: CockpitState | undefined, opts: HostedPageOptions = {}): string {
  const now = opts.now ?? opts.generatedAt ?? state?.generatedAt ?? "";
  const brief = routeHosted(state, "Daily command brief");
  const fr = freshnessView(state, now);
  const props = proposalsView(state, now);
  const fleet = fleetView(state, now);
  const mutation = mutationCenterView(state);
  const dispatch = mutationDispatchView(state);
  const briefing = fleetBriefingView(state, now);
  const synthesis = fleetSynthesisView(state, now);
  const autonomy = autonomyPreviewView(state, now);
  const factoryJobs = factoryJobView(state, now);
  const audit = auditTailView(auditRowsFromProposals(state));
  const rms = readModelStatusView(state);
  const threads = opts.threads ?? [];
  const perception = perceive({ now, freshness: fr, proposals: state?.proposalQueue ?? [], missingSources: rms.missingSources, fleetSignals: fleet.agents });
  const fleetWork = collectFleetTasks({ perception });
  const fleetPlan = orchestrateFleet(fleetWork);
  const fleetForecast = forecast({ now, perception, plan: fleetPlan, proposals: state?.proposalQueue ?? [] });
  // Cross-system synthesis: one ranked "do next" list, deduped against the live queue.
  // Shared with the persist route via cockpitSuggestions so the panel and the writer agree.
  // Pass the already-computed artifacts so the pipeline isn't run a second time per render.
  const suggestions = cockpitSuggestions(state, now, { perception, plan: fleetPlan, forecast: fleetForecast });

  // Cockpit V2 — the Executive Brief is the strategic-awareness brief (risks/opps/drift/blind),
  // enriched with executive memory when a host has supplied snapshots (honest otherwise).
  // Snapshots arrive via the live state (state-resolver reads the store) or, in tests, via opts.
  const memSnapshots: MemorySnapshot[] = state?.memorySnapshots ?? opts.memorySnapshots ?? [];
  const sbrief: StrategicBrief = strategicAwareness({
    now,
    panels: state?.panels ?? [],
    freshness: fr,
    proposals: state?.proposalQueue ?? [],
    perception,
    forecast: fleetForecast,
    synthesis: synthesis.available ? synthesis : null,
    ...(memSnapshots.length ? { history: memSnapshots } : {}),
  });
  const mem: ExecutiveMemoryReport = executiveMemory(memSnapshots, { now });

  // P1/P2/P10 — the meta-agent registry + the SPLIT status (operator vs system vs fleet vs
  // freshness vs proposals vs provider). A training/recovery risk is the OPERATOR's status, kept
  // separate so it never reads as "the HartOS system is broken".
  const metaReg = resolveMetaAgentRegistry({ now });
  const opRisk = sbrief.risks.find((rk) => /training|recovery|fitness|injur|fuel|sleep/i.test(`${rk.risk} ${rk.why}`));
  const statusSplit = computeStatusSplit({
    registry: metaReg,
    operator: opRisk ? { band: "red" as const, headline: opRisk.risk } : null,
    freshness: fr ? { staleCount: fr.staleDomains?.length ?? 0, unavailableCount: fr.unavailableDomains?.length ?? 0, note: fr.staleReason ?? undefined } : null,
    proposals: props.available ? { aging: sbrief.drift.some((d) => /backlog|aging/i.test(d.drift)) ? 1 : 0, pending: props.pending } : null,
  });

  const overall = (brief.highlights[0] ?? "Overall: AMBER.").replace(/^Overall:\s*/i, "").replace(/\.$/, "");
  const sysTone = tone(overall, "high", "live");
  const pending = props.available ? props.pending : 0;
  const topApproval = props.available ? props.proposals.find((p) => p.status === "pending_approval") ?? null : null;

  const topbar =
    `<div class="tb">` +
    `<form class="cmd" id="ask-form" action="/api/ask" method="post"><span>⌘</span>` +
    `<input id="q" type="text" placeholder="Ask HartOS… (⌘K)" autocomplete="off" aria-label="Ask HartOS">` +
    voiceInputButtonHtml() +
    `<button class="send" id="ask" type="submit" title="Ask HartOS" style="width:26px;height:26px;border:none;border-radius:7px;background:var(--primary);color:#fff;cursor:pointer">&#10148;</button></form>` +
    `<div class="grow"></div>` +
    `<span class="pill ${sysTone}"><span class="dot ${sysTone}"></span>${esc(overall.toUpperCase())}</span>` +
    `<span class="tstamp">⟳ ${esc(relTime(now, now))}</span>` +
    `</div>` +
    `<div class="wrap"><pre class="answer" id="out" style="display:none;margin:0 0 14px"></pre>`;

  const fleetSection = fleet.agents.length
    ? `<div class="grid4">${fleet.agents.map((a) => fleetCard(a, panelAdvice(state, a.type))).join("")}</div>`
    : `<div class="box"><div class="muted">${esc(fleet.note)}</div></div>`;

  // ── Views (UI v2 IA: Overview · Agent Organisation · Intelligence · Approvals · Technical) ──
  // Overview = CEO cockpit (command clarity). Technical = diagnostics. Every box still renders.
  const overview = viewBlock(
    "overview",
    true,
    renderStatusStrip(statusSplit) +
      sec("Executive Brief") + heroSection(sbrief, overall, sysTone, topApproval) +
      sec("Fleet") + fleetSection +
      sec("Knowledge & Intelligence") + knowledgeBox(opts.knowledge) +
      sec("Approval Queue") + approvalSummaryBox(props) +
      sec("Today's Focus") + focusSection(suggestions) +
      sec("Strategic Awareness") + awarenessSection(sbrief),
  );
  const agentsView = viewBlock(
    "agents",
    false,
    renderStatusStrip(statusSplit) + renderAgentOrgPanel(metaReg),
  );
  const intelligenceView = viewBlock(
    "intelligence",
    false,
    sec("Knowledge & Intelligence") + knowledgeBox(opts.knowledge) +
      sec("Executive Memory") + memorySection(mem) +
      sec("Fleet Brain") + fleetBrainBox(briefing) + fleetSynthesisBox(synthesis),
  );
  const approvalsView = viewBlock(
    "approvals",
    false,
    sec("Approvals") + proposalBox(props) + mutationCenterBox(mutation) +
      (autonomy.total > 0 ? autonomyBox(autonomy) : ""),
  );
  const technicalView = viewBlock(
    "technical",
    false,
    sec("Runtime Diagnostics") + diagnosticsBox(opts.diagnostics) +
      sec("System Health") +
      `<div class="grid3">` +
      trustBox(rms, fr) + freshBox(fr) + suggestionsBox(suggestions) +
      perceptionBox(perception, fleetWork) + orchestrationBox(fleetPlan) + forecastBox(fleetForecast) +
      mutationDispatchBox(dispatch) + auditBox(audit) + activityBox(threads) +
      (factoryJobs.total > 0 ? factoryJobBox(factoryJobs) : "") +
      `</div>`,
  );

  const body =
    `<div class="app2">${railV2(pending)}<main>` +
    topbar +
    overview + agentsView + intelligenceView + approvalsView + technicalView +
    `<footer>HartOS Command Center — hosted, read-only. Verdict computed from facts; the cockpit only reads and recommends. ` +
    `No provider / Supabase / ClickUp / Telegram writes. <a href="/health">health</a> · <a href="/api/state">state</a></footer>` +
    `</div>` +
    `</main>` +
    // UI v2 — persistent right-side Ask CLI (command terminal). Hidden < 1280px (⌘K covers mobile).
    `<aside class="askcli">` +
    `<div class="aclbl">HartOS Ask · command terminal</div>` +
    `<div class="acin"><input id="q2" type="text" placeholder="Ask HartOS…" autocomplete="off" aria-label="Ask HartOS"><button class="send" id="ask2" type="button" title="Ask HartOS" style="width:30px;border:none;border-radius:7px;background:var(--primary);color:#fff;cursor:pointer">&#10148;</button></div>` +
    `<pre class="answer" id="out2">Ask anything. The selected agent, live-LLM status, and any required proposal/runner show up here.</pre>` +
    `</aside>` +
    `</div>` +
    botnav(pending) +
    // Quick-peek drawer (card click) + ⌘K command palette — progressive enhancement.
    `<div class="overlay" id="ov"></div>` +
    `<aside class="drawer" id="drawer" aria-hidden="true"><div class="dwrap" id="dbody"></div></aside>` +
    `<div class="overlay" id="kov"></div>` +
    `<div class="kbar" id="kbar"><div class="kbox"><input id="kq" type="text" placeholder="Ask HartOS… (Enter to ask, Esc to close)" autocomplete="off" aria-label="Ask HartOS"><pre class="answer" id="kout" style="display:none;margin:10px 0 0"></pre></div></div>` +
    voiceInputClientScript() +
    `<script>
(function(){
  function esc(s){return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function fmt(d){
    if(d&&d.error){return 'Error: '+d.error;}
    var head='';
    if(d.routing){head+='\\u25B8 '+(d.routing.selectedAgentName||d.routing.selectedAgent||'Orchestrator')+' \\u00B7 '+(d.routing.mode||'')+' \\u00B7 '+(d.routing.confidence||'')+' confidence\\n';}
    if(typeof d.usedLlm!=='undefined'){head+=(d.usedLlm?'\\u25CF live LLM ('+(d.provider||'')+')':'\\u25CB deterministic'+(d.fallbackReason&&d.fallbackReason!=='none'?' ['+d.fallbackReason+']':'')+(d.gateReason?' \\u2014 '+d.gateReason:''))+'\\n';}
    var s=head+(head?'\\n':'')+(d.title?d.title+'\\n\\n':'')+(d.summary||'');
    if(d.routing){
      if(d.routing.requiresLocalRunner){s+='\\n\\n\\u2699 requires a local runner \\u2014 '+(d.routing.fallback||'');}
      else if(d.routing.needsProposal){s+='\\n\\n\\u2295 becomes a gated proposal'+(d.routing.needsApproval?' (needs your approval)':'')+'.';}
    }
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
  var q2=document.getElementById('q2'),ask2=document.getElementById('ask2'),out2=document.getElementById('out2');
  if(ask2&&q2){ask2.addEventListener('click',function(e){e.preventDefault();ask(q2.value,out2);});q2.addEventListener('keydown',function(e){if(e.key==='Enter'){e.preventDefault();ask(q2.value,out2);}});}
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
  var qb=document.getElementById('queue-suggestions'),qm=document.getElementById('queue-msg');
  if(qb){qb.addEventListener('click',function(){qb.disabled=true;if(qm){qm.textContent='queuing…';}
    fetch('/api/suggestions/persist',{method:'POST',headers:{'content-type':'application/json'},body:'{}'})
     .then(function(r){return r.json()}).then(function(d){
       var msg=d.queued>0?('Queued '+d.queued+' for approval — reloading…'):(d.alreadyQueued>0?'All already in the queue.':'Nothing new to queue.');
       if(qm){qm.textContent=msg;}
       if(d.queued>0){setTimeout(function(){location.reload();},900);}else{qb.disabled=false;}
     }).catch(function(){if(qm){qm.textContent='Network error.';}qb.disabled=false;});
  });}
  // Phase 2.4 — approve/reject a pending proposal via the gated Edge Function (no DB key here).
  document.addEventListener('click',function(e){
    var btn=e.target&&e.target.closest?e.target.closest('.pbtn'):null;
    if(!btn||btn.disabled){return;}
    var wrap=btn.closest('.pact');if(!wrap){return;}
    var id=wrap.getAttribute('data-pid'),act=btn.getAttribute('data-act');
    if(!id||!act){return;}
    Array.prototype.forEach.call(wrap.querySelectorAll('.pbtn'),function(b){b.disabled=true;});
    fetch('/api/proposals/transition',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({id:id,action:act})})
      .then(function(r){return r.json()}).then(function(d){wrap.innerHTML='<span class="muted">'+(d.ok?(act==='approve'?'approved':'rejected'):'no change')+'</span>';})
      .catch(function(){wrap.innerHTML='<span class="muted">error</span>';});
  });
  Array.prototype.forEach.call(document.querySelectorAll('.card[data-agent]'),function(card){card.addEventListener('click',function(e){e.preventDefault();openDrawer(card.getAttribute('data-agent'));});});
  document.addEventListener('keydown',function(e){
    if((e.metaKey||e.ctrlKey)&&(e.key==='k'||e.key==='K')){e.preventDefault();openK();}
    else if(e.key==='Escape'){closeK();closeDrawer();}
  });
  // Cockpit V2 — destination nav: rail + bottom-nav toggle server-rendered sections (no fetch).
  function showView(name){
    Array.prototype.forEach.call(document.querySelectorAll('.view'),function(s){
      if(s.getAttribute('data-view')===name){s.removeAttribute('hidden');}else{s.setAttribute('hidden','');}
    });
    Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'),function(n){
      if(n.getAttribute('data-nav')===name){n.classList.add('active');}else{n.classList.remove('active');}
    });
    window.scrollTo(0,0);
  }
  Array.prototype.forEach.call(document.querySelectorAll('[data-nav]'),function(n){
    n.addEventListener('click',function(){showView(n.getAttribute('data-nav'));});
    n.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();showView(n.getAttribute('data-nav'));}});
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
/**
 * Pure, server-rendered inline SVG line chart (no JS, no deps). Scales the series to
 * fit, draws an area + line + a dot on the latest point, and captions min/max/last.
 * Honest with thin data: <2 real points → "not enough data to plot" (never faked).
 */
function svgLineChart(points: Array<{ x: string; y: number | undefined }>, opts: { color?: string; dp?: number } = {}): string {
  const w = 300, h = 84, pad = 8;
  const dp = opts.dp ?? 0;
  const pts = points.filter((p): p is { x: string; y: number } => typeof p.y === "number" && Number.isFinite(p.y));
  if (pts.length < 2) {
    const one = pts.length === 1 ? ` (only 1 point: ${fmt(pts[0]!.y, dp)})` : "";
    return `<div class="sparkmeta">Not enough data to plot${one}.</div>`;
  }
  const ys = pts.map((p) => p.y);
  const min = Math.min(...ys), max = Math.max(...ys), range = max - min || 1;
  const iw = w - pad * 2, ih = h - pad * 2;
  const xAt = (i: number): number => pad + (i / (pts.length - 1)) * iw;
  const yAt = (v: number): number => pad + ih - ((v - min) / range) * ih;
  const line = pts.map((p, i) => `${i ? "L" : "M"}${xAt(i).toFixed(1)},${yAt(p.y).toFixed(1)}`).join(" ");
  const area = `${line} L${xAt(pts.length - 1).toFixed(1)},${(h - pad).toFixed(1)} L${pad.toFixed(1)},${(h - pad).toFixed(1)} Z`;
  const color = opts.color ?? "var(--accent)";
  const last = pts[pts.length - 1]!;
  return (
    `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="trend chart">` +
    `<path d="${area}" fill="${color}" opacity="0.10"/>` +
    `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` +
    `<circle cx="${xAt(pts.length - 1).toFixed(1)}" cy="${yAt(last.y).toFixed(1)}" r="3" fill="${color}"/>` +
    `</svg>` +
    `<div class="sparkmeta">min ${fmt(min, dp)} · max ${fmt(max, dp)} · last <b>${fmt(last.y, dp)}</b> · ${pts.length} pts</div>`
  );
}

function chartCard(title: string, points: Array<{ x: string; y: number | undefined }>, color: string, dp: number): string {
  return `<div class="chart"><div class="ct">${esc(title)}</div>${svgLineChart(points, { color, dp })}</div>`;
}

/** Bodyweight direction over the series (0.7kg deadband to ignore weigh-in noise). */
function bodyweightTrendOf(series: Array<{ date: string; kg: number }>): "rising" | "falling" | "flat" | undefined {
  if (series.length < 2) return undefined;
  const sorted = [...series].sort((a, b) => a.date.localeCompare(b.date));
  const delta = sorted[sorted.length - 1]!.kg - sorted[0]!.kg;
  if (Math.abs(delta) < 0.7) return "flat";
  return delta > 0 ? "rising" : "falling";
}

/** The fitness "Trends" charts grid (bodyweight / HRV / resting HR / sleep). */
function fitnessChartsSection(f: FitnessDetail): string {
  const charts: string[] = [];
  if (f.bodyweight.length >= 2) charts.push(chartCard("Bodyweight (kg)", f.bodyweight.map((b) => ({ x: b.date, y: b.kg })), "var(--accent)", 1));
  if (f.series.some((p) => p.hrvMs != null)) charts.push(chartCard("HRV (ms)", f.series.map((p) => ({ x: p.date, y: p.hrvMs })), "var(--green)", 0));
  if (f.series.some((p) => p.restingHr != null)) charts.push(chartCard("Resting HR (bpm)", f.series.map((p) => ({ x: p.date, y: p.restingHr })), "var(--amber)", 0));
  if (f.series.some((p) => p.sleepHours != null)) charts.push(chartCard("Sleep (h)", f.series.map((p) => ({ x: p.date, y: p.sleepHours })), "var(--primary)", 1));
  if (!charts.length) return "";
  return `<section class="box"><div class="blbl">Trends</div><div class="charts">${charts.join("")}</div></section>`;
}

/** Coaching section for the live fitness detail — runs the coach on the LIVE RPC data. */
function coachSection(f: FitnessDetail): string {
  const status = f.recovery.status;
  const recScore = status && /^\d+(\.\d+)?$/.test(status.trim()) ? Number(status) : undefined;
  const sig: CoachingSignals = {
    ...(recScore != null ? { recoveryScore: recScore } : {}),
    ...(status ? { recoveryLabel: status } : {}),
    ...(f.recovery.trainingDayType ? { trainingPlan: f.recovery.trainingDayType } : {}),
    ...(f.recovery.workoutCompleted !== undefined ? { trainingCompleted: f.recovery.workoutCompleted } : {}),
    ...(f.nutrition.caloriesConsumed != null ? { caloriesHave: f.nutrition.caloriesConsumed } : {}),
    ...(f.nutrition.caloriesTarget != null ? { caloriesTarget: f.nutrition.caloriesTarget } : {}),
    ...(f.nutrition.proteinConsumed != null ? { proteinHave: f.nutrition.proteinConsumed } : {}),
    ...(f.nutrition.proteinTarget != null ? { proteinTarget: f.nutrition.proteinTarget } : {}),
    ...((): { bodyweightTrend?: "rising" | "falling" | "flat" } => {
      const tr = bodyweightTrendOf(f.bodyweight);
      return tr ? { bodyweightTrend: tr } : {};
    })(),
  };
  const a = coach(sig);
  const t: Tone = a.verdict === "train_as_planned" ? "g" : a.verdict === "insufficient_data" ? "i" : "a";
  const drivers = a.drivers.length ? listHtml(a.drivers) : "";
  const mods = a.modifiers.length ? `<p class="muted">${esc(a.modifiers.join(" "))}</p>` : "";
  const unseen = a.unknowns.length ? ` · Unseen: ${esc(a.unknowns.join(", "))}` : "";
  return (
    `<section class="box"><div class="blbl">Coach</div>` +
    `<div class="why ${t}"><div class="wt">Coaching verdict</div>` +
    `<span class="verdict ${t}">${esc(a.verdict.replace(/_/g, " ").toUpperCase())}</span> &nbsp; ${esc(a.headline)}</div>` +
    `<p class="kv">${esc(a.reason)}</p>${drivers}${mods}` +
    `<p class="muted">Confidence: ${esc(a.confidence)}${unseen}</p></section>`
  );
}

/** Triage section for the live ops detail — runs the triage on the LIVE RPC data. */
function triageSection(o: OpsDetail): string {
  const sig: OpsSignals = {
    ...(o.counts.urgent != null ? { urgent: o.counts.urgent } : {}),
    ...(o.counts.blocked != null ? { blocked: o.counts.blocked } : {}),
    ...(o.counts.stale != null ? { stale: o.counts.stale } : {}),
    ...(o.counts.waiting != null ? { waiting: o.counts.waiting } : {}),
    ...(o.counts.noNextAction != null ? { noNextAction: o.counts.noNextAction } : {}),
    ...(o.counts.active != null ? { activeCards: o.counts.active } : {}),
    ...(o.riskFlags.length ? { riskFlags: o.riskFlags.map((r) => r.flag).join(", ") } : {}),
    syncStale: false, // live RPC data — just queried
  };
  const tr = triageOps(sig);
  const t: Tone = tr.verdict === "urgent" ? "r" : tr.verdict === "clear" ? "g" : tr.verdict === "insufficient_data" ? "i" : "a";
  const q = tr.queue.length
    ? tableHtml(["Front", "Count", "Severity", "Next action"], tr.queue.map((i) => [i.category, i.count > 0 ? String(i.count) : "—", i.severity, i.action]))
    : "";
  const caveat = tr.caveats.length ? `<p class="muted">${esc(tr.caveats.join(" "))}</p>` : "";
  return (
    `<section class="box"><div class="blbl">Triage</div>` +
    `<div class="why ${t}"><div class="wt">Triage verdict</div>` +
    `<span class="verdict ${t}">${esc(tr.verdict.replace(/_/g, " ").toUpperCase())}</span> &nbsp; ${esc(tr.primaryAction)}</div>` +
    `<p class="kv">${esc(tr.reason)} · ${tr.totalActionable} card(s) actionable · confidence ${esc(tr.confidence)}</p>${q}${caveat}</section>`
  );
}

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
      coachSection(f) +
      `<section class="box"><div class="blbl">Recovery</div>` +
      `<div class="why ${rt}"><div class="wt">Recovery verdict</div>` +
      `<span class="verdict ${rt}">${esc((f.recovery.status ?? "unknown").toUpperCase())}</span> &nbsp;` +
      `HRV <b>${fmt(f.recovery.hrvMs)}</b>ms · RHR <b>${fmt(f.recovery.restingHr)}</b> bpm · ` +
      `Sleep <b>${fmt(f.recovery.sleepHours, 1)}</b>h · Plan <b>${esc(f.recovery.trainingDayType ?? "—")}</b>` +
      `${f.recovery.workoutCompleted ? " · completed" : ""}</div></section>` +
      fitnessChartsSection(f) +
      `<section class="box"><div class="blbl">Recovery series</div>${tableHtml(["Date", "HRV (ms)", "RHR (bpm)", "Sleep (h)"], f.series.map((p) => [p.date, fmt(p.hrvMs), fmt(p.restingHr), fmt(p.sleepHours, 1)]))}</section>` +
      `<section class="box"><div class="blbl">Bodyweight</div>${tableHtml(["Date", "kg"], f.bodyweight.map((b) => [b.date, b.kg.toFixed(1)]))}</section>` +
      `<section class="box"><div class="blbl">Nutrition (today)</div><p class="kv">Calories <b>${fmt(f.nutrition.caloriesConsumed)}</b>/${fmt(f.nutrition.caloriesTarget)} · ` +
      `Protein <b>${fmt(f.nutrition.proteinConsumed)}</b>/${fmt(f.nutrition.proteinTarget)}g</p></section>` +
      `<section class="box"><div class="blbl">Recent workouts</div>${tableHtml(["Date", "Type", "Min"], f.workouts.map((w) => [w.date ?? "—", w.type ?? "—", fmt(w.minutes)]))}</section>`;
  } else {
    const o = detail;
    sections =
      triageSection(o) +
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
