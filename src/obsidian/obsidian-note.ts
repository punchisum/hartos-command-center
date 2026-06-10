/**
 * src/obsidian/obsidian-note.ts
 *
 * PURE rendering for Obsidian notes — turns an ObsidianNoteProposal into the Markdown file
 * content (YAML frontmatter + body) and computes its vault-relative path. No fs, no clock.
 * Obsidian reads YAML frontmatter natively (properties + tags), so the metadata is queryable.
 */

import type { ObsidianNoteProposal } from "./obsidian-types.js";

/** A filesystem-safe slug for the note filename. */
export function slugify(title: string): string {
  const s = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return s.length > 0 ? s : "note";
}

function yamlList(xs: string[]): string {
  return `[${xs.map((x) => JSON.stringify(x)).join(", ")}]`;
}

/** Vault-relative path for the note, e.g. "HartOS/Wolverine Audits/wolverine-audit-2026-06-10.md". */
export function notePath(p: ObsidianNoteProposal): string {
  const folder = p.folder.replace(/^[/\\]+|[/\\]+$/g, "");
  return `${folder}/${slugify(p.title)}.md`;
}

/** Render the full Markdown file content (frontmatter + body). Deterministic. */
export function renderObsidianNote(p: ObsidianNoteProposal): string {
  const fm: string[] = [
    "---",
    `title: ${JSON.stringify(p.title)}`,
    `type: ${p.noteType}`,
    `tags: ${yamlList(p.tags)}`,
    `created: ${p.createdAt}`,
  ];
  if (p.reviewBy) fm.push(`review_by: ${p.reviewBy}`);
  fm.push(`confidence: ${p.confidence}`);
  fm.push(`reason: ${JSON.stringify(p.reason)}`);
  if (p.relatedAgents && p.relatedAgents.length) fm.push(`related_agents: ${yamlList(p.relatedAgents)}`);
  if (p.relatedProposals && p.relatedProposals.length) fm.push(`related_proposals: ${yamlList(p.relatedProposals)}`);
  if (p.sources && p.sources.length) fm.push(`sources: ${yamlList(p.sources)}`);
  fm.push("generated_by: HartOS");
  fm.push("---");
  fm.push("");
  fm.push(p.body.trim());
  fm.push("");
  return fm.join("\n");
}
