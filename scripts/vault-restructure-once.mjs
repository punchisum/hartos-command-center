/**
 * scripts/vault-restructure-once.mjs — ONE-TIME vault reorganization (Hart-mandated 2026-06-12).
 *
 * The graph was a 170-spoke starburst because Home linked every note directly. After this:
 *   Home (lobby) → per-area MOCs (HartOS/Maps) → notes — a navigable tree.
 * Also tidies: loose daily note → Daily/, Misc reports → Reports & Audits/, setup guides →
 * SOPs & Runbooks/, removes the empty Untitled/. MOVES only — no note content is deleted.
 * Backs up Home.md to Home.backup.md before rewriting.
 */
import { readdirSync, statSync, mkdirSync, renameSync, writeFileSync, copyFileSync, existsSync, rmdirSync } from "node:fs";
import path from "node:path";

const V = process.env.HARTOS_OBSIDIAN_VAULT_PATH || "C:\\Users\\Hart Pun\\Documents\\HartOS-Vault";
const now = new Date().toISOString();
const day = now.slice(0, 10);
const log = (s) => console.log("  " + s);

// ── 1) tidy: moves ────────────────────────────────────────────────────────────
console.log("1) Tidy");
const moves = [];
// loose daily notes in the vault root → Daily/
for (const f of readdirSync(V)) {
  if (/^\d{4}-\d{2}-\d{2}\.md$/.test(f)) moves.push([f, `Daily/${f}`]);
}
// Misc → Reports & Audits (reports/audits/reviews) or SOPs (setup guides) or Agents (AGENTS.md)
const MISC = path.join(V, "Misc");
if (existsSync(MISC)) {
  for (const f of readdirSync(MISC)) {
    if (!f.endsWith(".md")) continue;
    if (/REPORT|AUDIT|REVIEW|SMOKE|MODE|GO_LIVE|COHERENCE|L3_TO_LIVE|MVP/i.test(f)) moves.push([`Misc/${f}`, `Reports & Audits/${f}`]);
    else if (/PROVIDER_SETUP|migrations/i.test(f)) moves.push([`Misc/${f}`, `SOPs & Runbooks/${f}`]);
    else if (/^AGENTS\.md$/i.test(f)) moves.push([`Misc/${f}`, `Agents & Factory/${f}`]);
  }
}
for (const [from, to] of moves) {
  const src = path.join(V, from), dst = path.join(V, to);
  if (!existsSync(src) || existsSync(dst)) { log(`skip ${from} (missing or destination exists)`); continue; }
  mkdirSync(path.dirname(dst), { recursive: true });
  renameSync(src, dst);
  log(`moved ${from} → ${to}`);
}
// drop the empty Untitled/
try { const u = path.join(V, "Untitled"); if (existsSync(u) && readdirSync(u).length === 0) { rmdirSync(u); log("removed empty Untitled/"); } } catch {}

// ── 2) index every area folder ────────────────────────────────────────────────
console.log("2) Index");
const AREAS = [
  ["Command Center MOC", "Cockpit", "The cockpit + command surface: routing, proposals, mutation spine."],
  ["Research Dossiers MOC", "HartOS/Research Dossiers", "Deep-research dossiers (cited, confidence-banded)."],
  ["Capability Scout MOC", "HartOS/Capability Scout", "Beezulbub OSS capability scouts (what to absorb)."],
  ["System Health MOC", "HartOS/Wolverine Audits", "Wolverine audits + Prophet forecasts — the immune + foresight record."],
  ["Agent Factory MOC", "Agents & Factory", "Agent specs, officiation, simulation, the factory pipeline."],
  ["Ops MOC", "Ops Agent", "Ops/business execution notes + ClickUp context."],
  ["Fitness MOC", "Fitness Agent", "Training / recovery / nutrition notes."],
  ["Doctrine MOC", "Vision & Doctrine", "The constitution: vision, doctrine, design principles."],
  ["Architecture MOC", "Architecture & Contracts", "System architecture, boundaries, provider contracts."],
  ["SOPs MOC", "SOPs & Runbooks", "Operating procedures + runbooks — how to run/recover things."],
  ["Roadmaps MOC", "Roadmaps & Plans", "Roadmaps, phase plans, implementation maps."],
  ["Handovers MOC", "Handovers", "Session handovers — what was done, what's next."],
  ["Reports & Audits MOC", "Reports & Audits", "Point-in-time reports, audits, reviews (the historical record)."],
  ["HartOS Core MOC", "HartOS", "HartOS living notes: build plans + generated working notes."],
  ["Daily MOC", "Daily", "Daily notes."],
];
const listMd = (rel) => {
  const dir = path.join(V, rel);
  if (!existsSync(dir)) return [];
  const out = [];
  const walk = (d, sub) => {
    for (const f of readdirSync(d)) {
      const p = path.join(d, f);
      if (statSync(p).isDirectory()) { if (rel === "HartOS" && ["Research Dossiers", "Capability Scout", "Wolverine Audits", "Maps"].includes(f)) continue; walk(p, sub ? `${sub}/${f}` : f); }
      else if (f.endsWith(".md")) out.push(f.replace(/\.md$/, ""));
    }
  };
  walk(dir, "");
  return out.sort();
};

// ── 3) write per-area MOCs into HartOS/Maps ───────────────────────────────────
console.log("3) Area maps");
const MAPS = path.join(V, "HartOS", "Maps");
mkdirSync(MAPS, { recursive: true });
const fm = (title, tags) => `---\ntitle: "${title}"\ntags: [${tags.join(", ")}]\nupdated: ${now}\ngenerated_by: HartOS\n---\n\n`;
const written = [];
for (const [title, rel, purpose] of AREAS) {
  const notes = listMd(rel);
  if (!notes.length) { log(`skip ${title} (no notes in ${rel})`); continue; }
  const body = fm(title, ["hartos", "moc"]) + `# ${title}\n\n> ${purpose}\n\n## Notes (${notes.length})\n\n` +
    notes.map((n) => `- [[${n}]]`).join("\n") +
    `\n\n_Map of Content · maintained by HartOS · updated ${day}. Additive only — no note is rewritten or deleted._\n`;
  writeFileSync(path.join(MAPS, `${title}.md`), body, "utf8");
  written.push([title, notes.length]);
  log(`wrote ${title} (${notes.length} notes)`);
}

// ── 4) Home becomes the slim lobby (backup first) ─────────────────────────────
console.log("4) Home");
const HOME = path.join(V, "00 - Start Here", "Home.md");
if (existsSync(HOME)) copyFileSync(HOME, path.join(V, "00 - Start Here", "Home.backup.md"));
const homeBody = fm("HartOS Vault — Home", ["hartos", "moc", "home"]) +
  `# 🧠 HartOS Vault\n\nThe **meaning layer** of HartOS. Start at an area map — every note lives one hop below.\n\n## Area maps\n\n` +
  written.map(([t, n]) => `- [[${t}]] _(${n})_`).join("\n") +
  `\n\n_Lobby · maintained by HartOS · updated ${day}. The old all-notes index is preserved in [[Home.backup]]._\n`;
writeFileSync(HOME, homeBody, "utf8");
log("Home rewritten as the slim lobby (backup: Home.backup.md)");
console.log("DONE — " + written.length + " area maps; the graph is now Home → maps → notes.");
