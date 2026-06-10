/**
 * src/obsidian/obsidian-types.ts
 *
 * Obsidian = the MEANING layer (per Hart's plan). HartOS stores human-readable, long-form context
 * as Markdown notes in a local vault (a plain folder of .md files) — never raw facts. The first
 * integration is PROPOSAL-BASED + approval-gated: HartOS proposes an ObsidianNoteProposal, Hart
 * approves, a local-only writer drops the note into the vault, and Wolverine later verifies it.
 *
 * This module is the pure CONTRACT only (no fs/clock). Rendering lives in obsidian-note.ts; the
 * gated writer in obsidian-writer.ts.
 */

/** The starter note types (Travel etc. come later). */
export type ObsidianNoteType =
  | "vision_doctrine"
  | "wolverine_audit_summary"
  | "executive_weekly_review"
  | "agent_handover"
  | "business_idea_dossier"
  /** A Research Agent dossier — synthesized key findings + reusable knowledge for the fleet. */
  | "research_dossier";

export type NoteConfidence = "high" | "medium" | "low";

/**
 * A proposed note — descriptive only until Hart approves + the writer is armed. Mirrors the
 * contract Hart specified: title, folder, tags, note type, source references, body, confidence,
 * reason, expiry/review date, related agents, related proposals.
 */
export interface ObsidianNoteProposal {
  title: string;
  /** Vault-relative folder, e.g. "HartOS/Wolverine Audits". */
  folder: string;
  noteType: ObsidianNoteType;
  tags: string[];
  /** The Markdown body (meaning / long-form context — not raw facts). */
  body: string;
  /** Source references this note is grounded in (e.g. "wolverine:audit", a proposal id). */
  sources: string[];
  confidence: NoteConfidence;
  /** Why this note exists (so the vault stays meaningful, not note-spam). */
  reason: string;
  /** ISO date by which the note should be reviewed/refreshed; null = no expiry. */
  reviewBy?: string | null;
  relatedAgents?: string[];
  relatedProposals?: string[];
  /** Injected ISO timestamp (no ambient clock). */
  createdAt: string;
}
