/**
 * src/runtime/views/agent-org-view.ts — Live Organism P2: the Agent Organisation panel + status
 * strip, rendered PURELY from the meta-agent registry (+ optional status split). Worker-safe HTML
 * (self-contained esc; no fs/clock/net). Shows the HartOS org hierarchy with each node's role,
 * honest status, and whether it's cockpit-callable / CLI-only / needs a local runner / needs approval.
 */

import { resolveMetaAgentRegistry, childrenOf, type MetaAgentRegistry, type MetaAgent } from "../../agents/meta-agent-registry.js";
import type { CockpitStatusSplit, StatusBand } from "../../cockpit/status-split.js";

function esc(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const BAND_COLOR: Record<StatusBand, string> = { green: "#3fb950", amber: "#d29922", red: "#f85149", unknown: "#8b949e" };
const STATUS_BAND: Record<string, StatusBand> = { live: "green", partial: "amber", local_only: "amber", stale: "amber", unavailable: "red" };

function dot(band: StatusBand): string {
  return `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${BAND_COLOR[band]};margin-right:6px"></span>`;
}

function badges(a: MetaAgent): string {
  const b: string[] = [];
  if (a.cockpitCallable) b.push("cockpit");
  if (a.cliOnly) b.push("CLI-only");
  if (a.requiresLocalRunner) b.push("runner");
  if (a.requiresApproval) b.push("approval");
  if (a.isOrgan) b.push("organ");
  return b.map((x) => `<span style="font-size:10px;opacity:.7;border:1px solid #444;border-radius:6px;padding:0 5px;margin-left:4px">${esc(x)}</span>`).join("");
}

function nodeRow(a: MetaAgent): string {
  const band = STATUS_BAND[a.status] ?? "unknown";
  return (
    `<div style="padding:2px 0">${dot(band)}<b>${esc(a.displayName)}</b> ` +
    `<span class="muted">— ${esc(a.role)}</span> ` +
    `<span style="font-size:11px;color:${BAND_COLOR[band]}">${esc(a.status)}</span>${badges(a)}` +
    `${a.status !== "live" ? `<div class="muted" style="font-size:11px;margin-left:14px">${esc(a.statusReason)}</div>` : ""}</div>`
  );
}

function subtree(reg: MetaAgentRegistry, id: string, depth: number): string {
  const kids = childrenOf(reg, id);
  if (kids.length === 0) return "";
  return `<div style="margin-left:${depth * 16}px">` + kids.map((k) => nodeRow(k) + subtree(reg, k.id, depth + 1)).join("") + `</div>`;
}

/** The full org panel: Hart → Orchestrator → agents, Factory → its children, organs inline. */
export function renderAgentOrgPanel(reg: MetaAgentRegistry = resolveMetaAgentRegistry()): string {
  const hart = reg.byId[reg.rootId];
  const c = reg.counts;
  return (
    `<section class="box"><div class="blbl">Agent Organisation</div>` +
    `<div class="muted" style="margin-bottom:6px">${c.total} nodes · ${c.live} live · ${c.partial} partial · ${c.unavailable} unavailable · ${c.cockpitCallable} cockpit-callable · ${c.localRunner} need a runner</div>` +
    (hart ? nodeRow(hart) : "") +
    subtree(reg, reg.rootId, 1) +
    `<div class="muted" style="font-size:11px;margin-top:8px">cockpit = callable from here · CLI-only / runner = needs a local runner · approval = gated. Read-only + propose-only; nothing executes from the cockpit.</div>` +
    `</section>`
  );
}

/** The split status strip — 6 honest bands so "training RED" never reads as "system broken". */
export function renderStatusStrip(split: CockpitStatusSplit): string {
  const tiles = split.groups
    .map(
      (g) =>
        `<div style="flex:1;min-width:150px;border:1px solid #2a2f3a;border-radius:8px;padding:8px">` +
        `<div style="font-size:10px;letter-spacing:.05em;opacity:.6;text-transform:uppercase">${esc(g.label)}</div>` +
        `<div style="margin:3px 0">${dot(g.band)}<b style="color:${BAND_COLOR[g.band]}">${esc(g.band.toUpperCase())}</b></div>` +
        `<div class="muted" style="font-size:11px">${esc(g.headline)}</div></div>`,
    )
    .join("");
  return `<section class="box"><div class="blbl">Status</div><div style="display:flex;flex-wrap:wrap;gap:8px">${tiles}</div></section>`;
}
