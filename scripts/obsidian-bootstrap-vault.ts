/**
 * scripts/obsidian-bootstrap-vault.ts — seed an Obsidian vault from the repos' MEANING docs.
 *
 * One-pass bootstrap: walks the HartOS repos, copies the human-readable Markdown docs (vision,
 * doctrine, plans, blueprints, contracts, cockpit/architecture, SOPs, handovers, agent docs)
 * into a grouped Obsidian vault, tags each with its repo source + sync date, and writes a Home
 * index (MOC) with wikilinks. Deliberately EXCLUDES the raw-fact sprawl per the Obsidian doctrine:
 * the *-reports/ dirs, agent-scaffold dupes, skills/templates, node_modules/.git/dist.
 *
 * Idempotent-ish: re-running overwrites the copies (the repo stays the source of truth).
 *
 *   node dist/scripts/obsidian-bootstrap-vault.js [vaultPath]
 */

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const REPOS = ["hartos-command-center", "hartos-agent-factory", "hart-os-fitness-trigger", "ops-agent-v2"];
const REPO_TAG: Record<string, string> = {
  "hartos-command-center": "cc",
  "hartos-agent-factory": "factory",
  "hart-os-fitness-trigger": "fitness",
  "ops-agent-v2": "ops",
};

const EXCLUDE_SEG = [
  /^node_modules$/,
  /^\.git$/,
  /^dist$/,
  /^agent-scaffold$/,
  /^\.agents$/,
  /^skills$/,
  /^templates$/,
  /^\.wrangler$/,
  /^coverage$/,
  /^cockpit-proposals$/,
  /-reports$/, // cockpit-reports, hartos-reports, read-model-reports, etc. (raw facts)
];

/** Filename/pattern → vault group. First match wins; else a repo default. */
const GROUPS: Array<[RegExp, string]> = [
  [/VISION|DOCTRINE|BLUEPRINT/i, "Vision & Doctrine"],
  [/PLAN|ROADMAP|ROAD_|TOMORROW|3_LEVELS|TO_80|FLYWHEEL/i, "Roadmaps & Plans"],
  [/HANDOVER/i, "Handovers"],
  [/SOP|RUNBOOK|DEPLOY|ROLLBACK|RELEASE|PROVISION|STAGING|PRODUCTION|LAUNCH|SECRET|CREDENTIAL|OBSERVABILITY|BOOTSTRAP/i, "SOPs & Runbooks"],
  [/COCKPIT|COMMAND_|CLOUDFLARE|HOSTED/i, "Cockpit"],
  [/AGENT_CREATION|FACTORY|PHASE9|PHASE10|BEEZULBUB|CAPABILITY|PACK|POISON|OPEN_SOURCE/i, "Agents & Factory"],
  [/CONTRACT|LLM_|BOUNDARY|READ_MODEL|INTEGRATION|ADAPTER|RUNTIME|ORCHESTRATOR|state-machines|contracts/i, "Architecture & Contracts"],
];

function excluded(rel: string): boolean {
  return rel.split(/[\\/]/).some((seg) => EXCLUDE_SEG.some((re) => re.test(seg)));
}

function groupFor(repo: string, rel: string, name: string): string {
  for (const [re, g] of GROUPS) if (re.test(name) || re.test(rel)) return g;
  if (repo === "hart-os-fitness-trigger") return "Fitness Agent";
  if (repo === "ops-agent-v2") return "Ops Agent";
  if (repo === "hartos-agent-factory") return "Agents & Factory";
  return "Misc";
}

interface DocFile { repo: string; full: string; rel: string; name: string; }

async function walk(dir: string, repoRoot: string, repo: string, acc: DocFile[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    const rel = path.relative(repoRoot, full);
    if (excluded(rel)) continue;
    if (e.isDirectory()) await walk(full, repoRoot, repo, acc);
    else if (e.name.toLowerCase().endsWith(".md") && e.name !== "SKILL.md") acc.push({ repo, full, rel, name: e.name });
  }
}

export async function bootstrapVault(githubRoot: string, vault: string, now: string): Promise<string[]> {
  const out: string[] = [`Obsidian vault bootstrap → ${vault}`];
  const docs: DocFile[] = [];
  for (const repo of REPOS) {
    await walk(path.join(githubRoot, repo), path.join(githubRoot, repo), repo, docs);
  }
  out.push(`Found ${docs.length} meaning docs across ${REPOS.length} repos (reports/scaffold/skills excluded).`);

  const byGroup = new Map<string, Array<{ noteName: string; repo: string; rel: string }>>();
  const usedTargets = new Set<string>();
  const day = now.slice(0, 10);

  for (const d of docs) {
    const group = groupFor(d.repo, d.rel, d.name);
    let base = d.name;
    let target = path.join(vault, group, base);
    if (usedTargets.has(target.toLowerCase())) {
      base = `${REPO_TAG[d.repo] ?? "x"}-${d.name}`; // de-collide same-named docs across repos
      target = path.join(vault, group, base);
    }
    usedTargets.add(target.toLowerCase());

    let body = "";
    try {
      body = await readFile(d.full, "utf8");
    } catch {
      continue;
    }
    const provenance = `> [!info] Synced from \`${d.repo}/${d.rel.replace(/\\/g, "/")}\` on ${day}. The repo is the source of truth; Wolverine will flag this note if it drifts.\n\n`;
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, provenance + body, "utf8");

    const arr = byGroup.get(group) ?? [];
    arr.push({ noteName: base.replace(/\.md$/i, ""), repo: d.repo, rel: d.rel.replace(/\\/g, "/") });
    byGroup.set(group, arr);
  }

  // Home index (MOC)
  const groupsSorted = [...byGroup.keys()].sort();
  const home: string[] = [
    "---",
    'title: "HartOS Vault — Home"',
    "tags: [hartos, moc, home]",
    `created: ${now}`,
    "generated_by: HartOS",
    "---",
    "",
    "# 🧠 HartOS Vault",
    "",
    "The **meaning layer** of HartOS — seeded from the repos' docs, grouped. Raw reports/logs are deliberately excluded (those live in Supabase). New living notes (Wolverine audits, weekly reviews, handovers, dossiers) are added by HartOS, approval-gated.",
    "",
    `> Seeded ${day} from ${docs.length} docs across ${REPOS.join(", ")}.`,
    "",
    "## Map of Content",
    "",
  ];
  for (const g of groupsSorted) {
    const items = (byGroup.get(g) ?? []).sort((a, b) => a.noteName.localeCompare(b.noteName));
    home.push(`### ${g}  _(${items.length})_`);
    for (const it of items) home.push(`- [[${it.noteName}]]`);
    home.push("");
    out.push(`  ${g}: ${items.length}`);
  }
  await mkdir(path.join(vault, "00 - Start Here"), { recursive: true });
  await writeFile(path.join(vault, "00 - Start Here", "Home.md"), home.join("\n"), "utf8");
  out.push(`Wrote Home index → 00 - Start Here/Home.md`);
  return out;
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const githubRoot = path.resolve(process.cwd(), "..");
  const vault =
    process.argv[2] ||
    process.env.HARTOS_OBSIDIAN_VAULT_PATH ||
    path.join(path.dirname(githubRoot), "HartOS-Vault");
  bootstrapVault(githubRoot, vault, new Date().toISOString())
    .then((lines) => {
      for (const l of lines) console.log(l);
      console.log(`\nDone. Open this folder as an Obsidian vault:\n  ${vault}\n`);
    })
    .catch((e) => {
      console.error(`bootstrap failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
