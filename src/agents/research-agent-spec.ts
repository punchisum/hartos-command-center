/**
 * src/agents/research-agent-spec.ts — the LOCKED AgentSpec for the Research Agent.
 *
 * This is the first REAL domain agent taken through the full Factory pipeline (compile → validate →
 * officiate → quality gate → simulate). It is the output the Spec Interrogator would lock: a
 * deep-research agent that plans a scoped inquiry, gathers sources (gated), synthesizes key findings
 * that each cite a source, and produces REUSABLE KNOWLEDGE for the whole fleet — then proposes its
 * dossier as a gated Obsidian note so it becomes usable across HartOS (Rinnegan → LLM Ask).
 *
 * Posture: born read-only + propose-only. Network + LLM are GATED capabilities the spec declares
 * explicitly (so the boundary gate permits them only because they're declared) — that makes it a
 * high-risk agent, so it MUST gate on approval. New-domain agents use the "other" read-model bucket
 * (ReadModelType has no "research"); identity is carried by label/icon/proposalTypes, not the bucket.
 */

import type { AgentSpec } from "../hartos/manifest-types.js";

export const RESEARCH_AGENT_SPEC: AgentSpec = {
  specId: "spec-research-agent-001",
  agentName: "research-agent",
  domain: "research",
  // New domain → the generic read-model bucket (ReadModelType: ops | fitness | other).
  targetReadModelType: "other",
  purpose:
    "Run deep, scoped research on a question and synthesize the key findings into reusable knowledge for the whole fleet — never fabricating an answer.",
  dataSources: ["research_dossiers", "research_sources"],
  capabilities: [
    "plan a research question into scoped sub-questions",
    "gather sources within a fail-closed boundary (gated)",
    "synthesize key findings that each cite a source",
    "produce reusable knowledge items usable across HartOS",
    "propose follow-up actions (never execute them)",
  ],
  label: "Research",
  icon: "🔬",
  // Propose-only vocabulary: a scoped job plan + a gated dossier-as-knowledge note.
  proposalTypes: ["research_plan", "research_dossier_note"],
  outputs: [
    {
      id: "dossier-summary",
      kind: "cockpit exec summary",
      targetFolder: "research/approved",
      description: "One-screen summary: verdict, key findings, confidence, open questions.",
    },
    {
      id: "dossier-knowledge-note",
      kind: "obsidian research dossier",
      targetFolder: "HartOS/Research Dossiers",
      description: "The dossier as a gated Obsidian note — reusable knowledge for the fleet.",
    },
  ],
  jobType: "research",
  boundary: {
    maxSearchDepth: 4,
    maxFilesWritten: 3,
    targetFolder: "research/approved",
    disallowedSources: ["social-media-rumor", "unverified-forum"],
    // GATED capabilities — declared explicitly so the boundary gate permits them; this is what
    // makes the agent high-risk and approval-gated. Undeclared, the gate would deny both.
    externalNetworkAllowed: true,
    llmAllowed: true,
    humanLocalizationNeeded: true,
    stopConditions: [
      "Stop when every sub-question is answered from gathered sources, or honestly marked unknown.",
      "Stop if the boundary gate refuses (depth > 4, > 3 files, or a disallowed source).",
      "Never fabricate a finding — list it as an unknown instead.",
    ],
  },
  acceptanceCriteria: [
    "Never fabricates a finding — unanswered sub-questions are listed as honest unknowns.",
    "Every key finding cites at least one gathered source.",
    "Produces reusable knowledge items applicable across HartOS.",
    "Stays propose-only — writes a dossier only via a gated, Hart-approved note proposal.",
  ],
  riskLevel: "high", // declares network + LLM → must gate on approval
  prereqs: ["A scoped, interrogated research request", "Gating: network + LLM capabilities approved for a run"],
  cockpitDone: true,
  approvalRequired: true,
  failureMode:
    "If sources cannot be gathered, it returns the sub-questions as unknowns at 'unknown' confidence and refuses to synthesize — it never invents findings to look complete.",
};
