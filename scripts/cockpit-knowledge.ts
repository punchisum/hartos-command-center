/**
 * scripts/cockpit-knowledge.ts — the unified cockpit "Knowledge & Intelligence" view (runnable).
 *
 * Links everything into one cockpit-style briefing: vault dossiers (research + capability scouts),
 * Beezulbub scout risk, the Wolverine immune verdict, and the Prophet forecast. Read-only. This is
 * the cockpit surface as a CLI; wiring the same composer into the deployed Worker dashboard card is
 * the gated next step (deploy is Hart's call).
 *
 *   HARTOS_OBSIDIAN_VAULT_PATH=... npm run cockpit:knowledge
 */

import { pathToFileURL } from "node:url";
import { execSync } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { composeKnowledgeSurface, renderKnowledgeSurface, type KnowledgeDossier } from "../src/cockpit/knowledge-surface.js";
import { readCapabilityScouts } from "../src/beezulbub/scout-vault-reader.js";
import { wolverineAudit } from "../src/wolverine/wolverine-audit.js";
import { forecast } from "../src/prophet/forecast.js";
import type { GitFacts } from "../src/wolverine/wolverine-types.js";

const DOSSIER_FOLDERS = ["HartOS/Research Dossiers", "HartOS/Capability Scout"];

function frontmatter(body: string, key: string): string | null {
  const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  if (!m) return null;
  return m[1].trim().replace(/^"(.*)"$/, "$1");
}

/** Read filed knowledge dossiers from the vault (research + capability), lightly parsed. */
async function readKnowledgeDossiers(vault: string | undefined): Promise<KnowledgeDossier[]> {
  if (!vault) return [];
  const out: KnowledgeDossier[] = [];
  for (const folder of DOSSIER_FOLDERS) {
    const dir = path.join(vault, ...folder.split("/"));
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      if (!e.isFile() || !e.name.toLowerCase().endsWith(".md")) continue;
      try {
        const body = await readFile(path.join(dir, e.name), "utf8");
        out.push({
          title: frontmatter(body, "title") ?? body.match(/^#\s*(.+)$/m)?.[1]?.trim() ?? e.name.replace(/\.md$/, ""),
          type: frontmatter(body, "type") ?? (folder.includes("Capability") ? "capability_dossier" : "research_dossier"),
          confidence: frontmatter(body, "confidence"),
          day: (frontmatter(body, "created") ?? "").slice(0, 10) || null,
        });
      } catch {
        /* skip */
      }
    }
  }
  return out;
}

function gatherGitFacts(cwd: string): GitFacts | undefined {
  const git = (args: string): string | null => {
    try {
      return execSync(`git ${args}`, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch {
      return null;
    }
  };
  const branch = git("rev-parse --abbrev-ref HEAD");
  if (branch === null) return undefined;
  const porcelain = git("status --porcelain");
  const lines = porcelain ? porcelain.split(/\r?\n/).filter(Boolean) : [];
  const untracked = lines.filter((l) => l.startsWith("??")).length;
  const ahead = git("rev-list --count @{u}..HEAD");
  return {
    branch,
    untracked,
    uncommitted: lines.length - untracked,
    ahead: ahead !== null && /^\d+$/.test(ahead) ? Number(ahead) : null,
    hasUpstream: ahead !== null,
  };
}

const invokedDirectly = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void (async () => {
    const now = new Date().toISOString();
    const vault = process.env.HARTOS_OBSIDIAN_VAULT_PATH;
    const dossiers = await readKnowledgeDossiers(vault);
    const capabilityScouts = await readCapabilityScouts(vault);
    const wolverine = wolverineAudit({ now, env: process.env, git: gatherGitFacts(process.cwd()), capabilityScouts });
    const fcast = forecast({ now, wolverine, capabilityScouts });
    const surface = composeKnowledgeSurface({ dossiers, capabilityScouts, wolverine, forecast: fcast });
    for (const line of renderKnowledgeSurface(surface)) console.log(line);
    console.log("");
  })();
}
