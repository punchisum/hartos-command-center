/**
 * src/runtime/cloudflare-cockpit-page.ts
 *
 * Phase 16 — the hosted Command Center cockpit HTML.
 *
 * Three variants, all read-only and secret-free:
 *   - renderHostedCockpitPage(state, opts)  → the landing cockpit (authed)
 *   - renderLoginPage(opts)                 → the access-token login screen
 *   - renderLockedPage(opts)                → fail-closed page (auth misconfigured)
 *
 * The page is intentionally minimal: server-rendered, grounded sections
 * (Daily Command Brief, Attention Needed, Fitness, Ops, Freshness,
 * Factory/Proposals, Known Gaps) plus an Ask HartOS box that POSTs to /api/ask.
 * Action buttons render DISABLED. No secrets are ever embedded. All dynamic
 * text is HTML-escaped.
 */

import type { CockpitState } from "../cockpit/cockpit-types.js";
import { routeHosted, freshnessView, proposalsView, fleetView } from "./cloudflare-cockpit-views.js";
import { ACTION_EXECUTION } from "./cloudflare-security.js";

export interface HostedPageOptions {
  runtimeMode?: string;
  generatedAt?: string | null;
  /** ISO now used for freshness; defaults to the snapshot generatedAt. */
  now?: string;
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
:root{color-scheme:light dark}
*{box-sizing:border-box}
body{font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;margin:0;background:#0f1115;color:#e7e9ee}
header{padding:16px 20px;border-bottom:1px solid #232733;display:flex;align-items:center;gap:12px;flex-wrap:wrap}
header h1{font-size:17px;margin:0;font-weight:650}
.badge{font-size:12px;padding:2px 8px;border-radius:999px;border:1px solid #333a49;color:#aeb6c6}
.badge.ro{border-color:#3b5;color:#7fdca0}
main{max-width:920px;margin:0 auto;padding:20px}
section{background:#161a22;border:1px solid #232733;border-radius:12px;padding:16px;margin:0 0 16px}
section h2{font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:#8b93a7;margin:0 0 10px}
.verdict{display:inline-block;font-weight:700;padding:3px 10px;border-radius:8px;font-size:13px}
.green{background:#15351f;color:#7fdca0;border:1px solid #265e38}
.amber{background:#3a2f12;color:#e9c46a;border:1px solid #6a521f}
.red{background:#3a1717;color:#f08f8f;border:1px solid #6a2626}
.main-action{margin-top:10px;font-size:16px;font-weight:600}
ol,ul{margin:8px 0;padding-left:20px}
li{margin:3px 0}
.muted{color:#8b93a7}
.kv{margin:4px 0}
.kv b{color:#cdd3df}
pre.answer{white-space:pre-wrap;background:#0f1115;border:1px solid #232733;border-radius:8px;padding:12px;margin-top:12px}
.ask-row{display:flex;gap:8px;margin-top:8px}
.ask-row input[type=text]{flex:1;padding:10px;border-radius:8px;border:1px solid #333a49;background:#0f1115;color:#e7e9ee}
button{padding:10px 16px;border-radius:8px;border:1px solid #333a49;background:#1d2330;color:#e7e9ee;cursor:pointer;font-weight:600}
button:hover{background:#252c3c}
button[disabled]{opacity:.45;cursor:not-allowed}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}
.chip{font-size:12px;padding:4px 9px;border-radius:999px;border:1px solid #333a49;background:#10141c;color:#aeb6c6;cursor:pointer}
.disabled-note{font-size:12px;color:#8b93a7;margin-top:6px}
footer{max-width:920px;margin:0 auto;padding:0 20px 30px;color:#6b7384;font-size:12px}
a{color:#7fb2ff}
.login-card{max-width:420px;margin:8vh auto;padding:24px}
.err{color:#f08f8f;font-size:13px;margin-top:8px;min-height:18px}
`;

function verdictClass(v: string): string {
  const lv = v.toLowerCase();
  return lv === "green" || lv === "amber" || lv === "red" ? lv : "amber";
}

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

/** The access-token login screen. No secret is embedded; the form POSTs to /api/login. */
export function renderLoginPage(opts: { error?: string; redirectTo?: string } = {}): string {
  // Same-origin path only (default "/"). Guard against open-redirect: must start
  // with a single "/" and not "//".
  const target =
    typeof opts.redirectTo === "string" && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(opts.redirectTo)
      ? opts.redirectTo
      : "/";
  const body =
    `<main><section class="login-card">` +
    `<h1 style="margin:0 0 4px">HartOS Command Center</h1>` +
    `<p class="muted">Read-only hosted cockpit. Enter your access token to continue.</p>` +
    `<div class="ask-row" style="flex-direction:column;gap:10px">` +
    `<input id="t" type="password" placeholder="Access token" autocomplete="current-password" autofocus>` +
    `<button id="go" type="button">Sign in</button></div>` +
    `<div class="err" id="err">${opts.error ? esc(opts.error) : ""}</div>` +
    `</section></main>` +
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
    `<main><section class="login-card">` +
    `<h1 style="margin:0 0 4px">HartOS Command Center</h1>` +
    `<div class="verdict red">LOCKED</div>` +
    `<p class="muted" style="margin-top:12px">This cockpit is failing closed: an access token is required but ` +
    `<code>HARTOS_COCKPIT_ACCESS_TOKEN</code> is not configured. Set it as a Wrangler secret and redeploy.</p>` +
    `<p class="muted"><code>wrangler secret put HARTOS_COCKPIT_ACCESS_TOKEN</code></p>` +
    `</section></main>`;
  return shell("HartOS Command Center — Locked", body);
}

function listHtml(items: string[], ordered = false): string {
  if (items.length === 0) return `<p class="muted">None.</p>`;
  const tag = ordered ? "ol" : "ul";
  return `<${tag}>${items.map((i) => `<li>${escMultiline(i)}</li>`).join("")}</${tag}>`;
}

/** The authed landing cockpit. Grounded, read-only, action buttons disabled. */
export function renderHostedCockpitPage(state: CockpitState | undefined, opts: HostedPageOptions = {}): string {
  const now = opts.now ?? opts.generatedAt ?? state?.generatedAt ?? "";
  const brief = routeHosted(state, "Daily command brief");
  const fr = freshnessView(state, now);
  const props = proposalsView(state);

  const overall = (brief.highlights[0] ?? "Overall: AMBER.").replace(/^Overall:\s*/i, "").replace(/\.$/, "");
  const mainAction = (brief.highlights.find((h) => h.startsWith("Main action:")) ?? "Main action: review the cockpit.").replace(/^Main action:\s*/i, "");
  const attention = brief.highlights.filter((h) => !h.startsWith("Overall:") && !h.startsWith("Main action:"));

  const fitnessAns = routeHosted(state, "How is my fitness today?");
  const opsAns = routeHosted(state, "Anything urgent in ops?");
  const fleet = fleetView(state, now);

  const freshnessSection = fr
    ? `<div class="kv"><span class="verdict ${verdictClass(fr.verdict)}">${esc(fr.verdict.toUpperCase())}</span> &nbsp;${esc(fr.verdictReason)}</div>` +
      listHtml(
        fr.domains.map((d) => `${d.domain[0]!.toUpperCase()}${d.domain.slice(1)}: ${d.state}${d.lastUpdated ? ` (updated ${d.lastUpdated})` : ""}`)
      ) +
      (fr.staleReason ? `<p class="muted">${esc(fr.staleReason)}</p>` : "") +
      `<p class="kv"><b>ClickUp sync:</b> ${fr.clickup.stale ? "STALE" : "current"}; last activity ${esc(fr.clickup.lastImportAt ?? "unknown")}.</p>` +
      `<p class="muted">Safe next step: ${esc(fr.safeNextStep)}</p>`
    : `<p class="muted">Freshness is unavailable in this snapshot (no live panels). Bake a snapshot with read-models enabled.</p>`;

  const proposalsSection =
    `<p class="kv"><b>${props.total}</b> proposal(s)${props.pending ? `, ${props.pending} pending` : ""} — ${esc(props.note)}</p>` +
    (props.proposals.length
      ? listHtml(props.proposals.map((p) => `[${p.domain}/${p.riskLevel}] ${p.title} — ${p.status}`))
      : "") +
    `<button disabled title="Execution is disabled in the hosted cockpit">Approve / execute (disabled)</button>` +
    `<div class="disabled-note">Action execution is <b>${esc(ACTION_EXECUTION)}</b>. Proposals are dry-run only and cannot be executed here.</div>`;

  const factoryHosted = opts.runtimeMode === "hosted";

  const body =
    `<header>` +
    `<h1>HartOS Command Center</h1>` +
    `<span class="badge ro">read-only</span>` +
    `<span class="badge">action execution: ${esc(ACTION_EXECUTION)}</span>` +
    (opts.generatedAt ? `<span class="badge">snapshot ${esc(opts.generatedAt)}</span>` : "") +
    `</header><main>` +
    // Daily Command Brief
    `<section><h2>Daily Command Brief</h2>` +
    `<div><span class="verdict ${verdictClass(overall)}">${esc(overall.toUpperCase())}</span></div>` +
    `<div class="main-action">${esc(mainAction)}</div>` +
    `</section>` +
    // Attention Needed
    `<section><h2>Attention Needed</h2>${listHtml(attention, true)}</section>` +
    // Fleet — unified cross-agent view (both agents on the shared AgentSignal)
    `<section><h2>Fleet</h2><pre class="answer">${escMultiline(fleet.rendered)}</pre>` +
    (fleet.available ? "" : `<div class="disabled-note">${esc(fleet.note)}</div>`) +
    `</section>` +
    // Fitness
    `<section><h2>Fitness</h2><pre class="answer">${escMultiline(fitnessAns.summary)}</pre></section>` +
    // Ops
    `<section><h2>Ops</h2><pre class="answer">${escMultiline(opsAns.summary)}</pre>` +
    `<button disabled title="Execution is disabled">Re-run ClickUp import (disabled)</button>` +
    `<div class="disabled-note">The hosted cockpit cannot run imports or any action — refresh ClickUp manually.</div></section>` +
    // Freshness
    `<section><h2>Freshness / Sync</h2>${freshnessSection}</section>` +
    // Factory / Proposals
    `<section><h2>Factory / Proposals</h2>` +
    `<p class="kv"><b>Factory:</b> ${factoryHosted ? "local reports unavailable in hosted mode (snapshot only)." : "available locally."}</p>` +
    proposalsSection +
    `</section>` +
    // Known Gaps
    `<section><h2>Known Gaps</h2>${listHtml(brief.gaps)}</section>` +
    // Ask HartOS
    `<section><h2>Ask HartOS</h2>` +
    `<div class="ask-row"><input id="q" type="text" placeholder="e.g. What needs my attention today?" autocomplete="off">` +
    `<button id="ask" type="button">Ask</button></div>` +
    `<div class="chips">` +
    ["What needs my attention today?", "Is my data fresh?", "Anything urgent in ops?", "Why is ops stale?", "Show pending proposals"]
      .map((c) => `<span class="chip" data-q="${esc(c)}">${esc(c)}</span>`)
      .join("") +
    `</div>` +
    `<pre class="answer" id="out" style="display:none"></pre>` +
    `<div class="disabled-note">Status and brief questions never create proposals; the cockpit only reads and recommends.</div>` +
    `</section>` +
    `</main>` +
    `<footer>HartOS Command Center — hosted, read-only. No provider/Supabase/ClickUp/Telegram writes. ` +
    `<a href="/health">health</a></footer>` +
    `<script>
(function(){
  var q=document.getElementById('q'),ask=document.getElementById('ask'),out=document.getElementById('out');
  function run(text){
    if(!text){return;}
    out.style.display='block';out.textContent='…';
    fetch('/api/ask',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({request:text})})
      .then(function(r){return r.json()})
      .then(function(d){
        if(d&&d.error){out.textContent='Error: '+d.error;return;}
        var s=(d.title?d.title+'\\n\\n':'')+(d.summary||'');
        if(d.nextSteps&&d.nextSteps.length){s+='\\n\\nNext steps:\\n- '+d.nextSteps.join('\\n- ');}
        out.textContent=s;
      })
      .catch(function(){out.textContent='Network error.';});
  }
  ask.addEventListener('click',function(){run(q.value);});
  q.addEventListener('keydown',function(e){if(e.key==='Enter')run(q.value);});
  Array.prototype.forEach.call(document.querySelectorAll('.chip'),function(c){
    c.addEventListener('click',function(){q.value=c.getAttribute('data-q');run(q.value);});
  });
})();
</script>`;
  return shell("HartOS Command Center", body);
}
