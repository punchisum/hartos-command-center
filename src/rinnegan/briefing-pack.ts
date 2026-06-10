/**
 * src/rinnegan/briefing-pack.ts — PURE dossier → BriefingPack extractor (Live Organism P5).
 *
 * Fixes "the Ask knows a dossier exists but not its substance". Given a dossier note body it pulls
 * the SUBSTANCE — title, one-line verdict + confidence, key findings, recommendations, source count
 * — within a context budget, so Rinnegan feeds the LLM findings, not just the framing/intro.
 *
 * Defensive regex parsing (no throwing); works on the research_dossier + capability_dossier shapes
 * this repo writes (## Executive summary / ## Key findings / ## Reusable knowledge / ## Sources;
 * ## Recommendation / ## Candidates). PURE + Worker-safe: no fs / clock / network.
 */

export type DossierType = "research_dossier" | "capability_dossier" | "note";

export interface BriefingPack {
  title: string;
  type: DossierType;
  /** One-line verdict (confidence + shape/recommendation). */
  verdict: string;
  confidence: string;
  keyFindings: string[];
  recommendations: string[];
  sourceCount: number;
  /** Budget-bounded substance excerpt for the LLM. */
  excerpt: string;
}

function fm(body: string, key: string): string | null {
  const m = body.match(new RegExp(`^${key}:\\s*(.+)$`, "m"));
  return m ? m[1].trim().replace(/^"(.*)"$/, "$1") : null;
}

function detectType(body: string, tags: string[] = []): DossierType {
  const t = `${tags.join(" ")} ${fm(body, "type") ?? ""}`.toLowerCase();
  if (/capability/.test(t) || /^#\s*Capability Scout/m.test(body)) return "capability_dossier";
  if (/research/.test(t) || /^#\s*Research Dossier/m.test(body)) return "research_dossier";
  return "note";
}

/** Extract the lines of a `## Section` (until the next `## ` or end). */
function section(body: string, heading: RegExp): string {
  const lines = body.split(/\r?\n/);
  const out: string[] = [];
  let inSec = false;
  for (const l of lines) {
    if (/^##\s+/.test(l)) {
      if (inSec) break;
      inSec = heading.test(l);
      continue;
    }
    if (inSec) out.push(l);
  }
  return out.join("\n").trim();
}

/** Bullet/`### heading` items from a section, condensed to one line each. */
function items(sec: string, max = 5): string[] {
  const out: string[] = [];
  const lines = sec.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < max; i++) {
    const l = lines[i].trim();
    const h = l.match(/^###\s+(.+)/);
    if (h) {
      // research key findings: "### <question>" then prose on following lines.
      const next = (lines[i + 1] ?? "").trim() || (lines[i + 2] ?? "").trim();
      out.push(`${h[1].replace(/[?:]+$/, "")}${next ? ` — ${next.slice(0, 200)}` : ""}`.trim());
    } else if (/^[-*•]\s+/.test(l)) {
      out.push(l.replace(/^[-*•]\s+/, "").replace(/^\*\*(.+?)\*\*/, "$1").slice(0, 220));
    }
  }
  // Fallback: a section with no bullets/headings (e.g. a plain ## Recommendation paragraph) —
  // take its first non-empty prose lines so the substance is still captured.
  if (out.length === 0) {
    for (const raw of lines) {
      const l = raw.trim();
      if (l && !/^_/.test(l) && out.length < max) out.push(l.replace(/^\*\*(.+?)\*\*/, "$1").slice(0, 220));
    }
  }
  return out.filter(Boolean);
}

export function buildBriefingPack(
  note: { relPath?: string; title: string; tags?: string[]; body: string },
  opts: { budget?: number } = {},
): BriefingPack {
  const budget = opts.budget ?? 1400;
  const body = note.body ?? "";
  const type = detectType(body, note.tags ?? []);
  const confidence = (fm(body, "confidence") ?? body.match(/\*\*Confidence:\s*(\w+)\*\*/i)?.[1] ?? "unknown").toLowerCase();

  let keyFindings: string[] = [];
  let recommendations: string[] = [];
  let verdict = "";
  let sourceCount = 0;

  if (type === "research_dossier") {
    keyFindings = items(section(body, /key findings/i), 5);
    if (keyFindings.length === 0) keyFindings = items(section(body, /executive summary/i), 5);
    recommendations = items(section(body, /reusable knowledge|recommend/i), 4);
    const sm = body.match(/from\s+(\d+)\s+source/i) ?? body.match(/##\s*Sources\b([\s\S]*?)(?=\n##\s|$)/i);
    sourceCount = sm ? (/^\d+$/.test(sm[1] ?? "") ? Number(sm[1]) : (sm[1]?.match(/^[-*]\s/gm)?.length ?? 0)) : 0;
    verdict = `${confidence.toUpperCase()} confidence research — ${keyFindings.length} key finding(s)`;
  } else if (type === "capability_dossier") {
    recommendations = items(section(body, /recommendation/i), 2);
    keyFindings = items(section(body, /candidates/i), 5);
    sourceCount = (body.match(/^-\s*source:/gim)?.length ?? 0) || keyFindings.length;
    verdict = `${confidence.toUpperCase()} confidence capability scout — ${keyFindings.length} candidate(s)`;
  } else {
    keyFindings = items(body, 4);
    verdict = "note";
  }

  const parts = [
    verdict,
    keyFindings.length ? `Key: ${keyFindings.join(" · ")}` : "",
    recommendations.length ? `Recommend: ${recommendations.join(" · ")}` : "",
  ].filter(Boolean);
  let excerpt = parts.join(" | ");
  if (excerpt.length > budget) excerpt = `${excerpt.slice(0, budget)}…`;

  return { title: note.title, type, verdict, confidence, keyFindings, recommendations, sourceCount, excerpt };
}

/** Compact single-line briefing for the LLM context. */
export function briefingPackToText(p: BriefingPack): string {
  return `${p.title} [${p.verdict}]: ${p.excerpt}`;
}
