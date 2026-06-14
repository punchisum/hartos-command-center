/**
 * src/hartos/council-spec-concretizer.ts
 *
 * P7 concretize pass: turn a council payload (strategic prose) into a CONCRETE,
 * Factory-buildable HartOS-internal agent spec via a single Claude-on-Max LLM call.
 *
 * The council's specialist findings — especially the CTO finding — already hold concrete
 * architecture (read sources, interfaces, commands). This module mines that architecture
 * and produces the `ConcreteAgentSpec` that the council→factory bridge can feed directly
 * into `compileSpecToManifest` + `planFromManifest`.
 *
 * Design constraints (per P7 brief):
 *   - Never throws. All errors return null (fail-closed).
 *   - All LLM input is redacted before the call (secrets never reach the model).
 *   - Validates every required field of the parsed JSON; any missing/empty field → null.
 *   - The `Infer` seam is injected — no ambient LLM, no real Claude in tests.
 *   - Pure module import graph: no node:fs, no pg, no Supabase, no network.
 */

import type { CouncilProposalPayload } from "../council/council-types.js";
import type { Infer } from "../council/specialist.js";
import { redact } from "../llm/redaction.js";

// ─── ConcreteAgentSpec ────────────────────────────────────────────────────────

/**
 * A concrete, Factory-buildable agent spec derived from the council payload.
 * All fields are mandatory and non-empty — the concretizer returns null if any
 * are missing or blank.
 */
export interface ConcreteAgentSpec {
  /** Short kebab-case agent name (e.g. "fitness-adherence-agent"). */
  agentName: string;
  /** One-line statement of what this agent does. */
  capability: string;
  /** Data sources / RPCs the agent reads (Supabase table or RPC names). */
  readSources: string[];
  /** The read-model and proposal type this agent produces. */
  output: string;
  /** The concrete operations the agent handles. */
  commands: string[];
  /** Cockpit surfaces / APIs this agent surfaces. */
  interfaces: string[];
  /** Measurable acceptance criterion (number/threshold a human can verify). */
  measurableAcceptance: string;
  /** How the agent fails safely and what correction looks like. */
  failureMode: string;
}

// ─── Required field IDs for validation ────────────────────────────────────────

const REQUIRED_STRING_FIELDS: Array<keyof ConcreteAgentSpec> = [
  "agentName",
  "capability",
  "output",
  "measurableAcceptance",
  "failureMode",
];

const REQUIRED_ARRAY_FIELDS: Array<keyof ConcreteAgentSpec> = [
  "readSources",
  "commands",
  "interfaces",
];

// ─── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Cap a string to `max` chars to avoid bloating the prompt.
 */
function cap(s: string, max: number): string {
  return s.length <= max ? s : s.slice(0, max) + "…";
}

/**
 * Build the redacted LLM prompt pair for the concretize pass.
 * The `user` field has all secrets scrubbed via `redact` before reaching the model.
 */
export function buildConcretizePrompt(payload: CouncilProposalPayload): {
  system: string;
  user: string;
} {
  const system =
    `You are a HartOS Factory agent-spec writer. ` +
    `Translate the approved council strategy below into a CONCRETE, buildable HartOS-INTERNAL agent spec. ` +
    `The agent must be: READ-ONLY (no writes, no mutations), PROPOSE-ONLY per HartOS doctrine, ` +
    `and config-not-code (configuration, not raw codegen). ` +
    `Mine the specialist findings -- especially the CTO finding -- for the concrete architecture: ` +
    `data sources, RPCs, cockpit interfaces, and commands. ` +
    `This is the FIRST agent to build toward the goal; keep scope minimal and read-only. ` +
    `Return ONLY a JSON object with EXACTLY these fields (no other text, no markdown fences): ` +
    `{ ` +
    `"agentName": "<kebab-case name, e.g. fitness-adherence-agent>", ` +
    `"capability": "<one-line: what it reads and surfaces>", ` +
    `"readSources": ["<Supabase table or RPC name>", ...], ` +
    `"output": "<the read-model type + proposal type it produces>", ` +
    `"commands": ["<concrete operation name>", ...], ` +
    `"interfaces": ["<cockpit surface or API name>", ...], ` +
    `"measurableAcceptance": "<a number or threshold a human can check>", ` +
    `"failureMode": "<how it fails safely + rollback note>" ` +
    `}`;

  // Build the user section from redacted council content.
  const redactedGoal = redact(cap(payload.rootGoal, 400));
  const redactedRec = redact(cap(payload.recommendation, 400));

  const findingSummaries = payload.tree.findings
    .map((f) => {
      const label = `[${f.specialistId.toUpperCase()} -- ${f.lens}]`;
      const summary = redact(cap(f.summary, 500));
      const risks = f.risks.length > 0
        ? ` Risks: ${f.risks.map((r) => redact(cap(r, 100))).join("; ")}.`
        : "";
      return `${label} ${summary}${risks}`;
    })
    .join("\n\n");

  const rawUser =
    `COUNCIL GOAL: ${redactedGoal}\n\n` +
    `COUNCIL RECOMMENDATION: ${redactedRec}\n\n` +
    `SPECIALIST FINDINGS:\n${findingSummaries || "(none)"}`;

  // The user section is already redacted above; run a final pass for safety.
  const user = redact(rawUser);

  return { system, user };
}

// ─── JSON parser + validator ─────────────────────────────────────────────────

/**
 * Parse and validate the model's JSON response into a ConcreteAgentSpec.
 * Returns null on any parse error, type mismatch, or missing/empty required field.
 * Never throws.
 */
export function parseConcretizeResponse(raw: string): ConcreteAgentSpec | null {
  try {
    // Strip optional markdown code-fence wrapping.
    let text = raw.trim();
    const fenceMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
    if (fenceMatch) {
      text = fenceMatch[1]!.trim();
    }

    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const obj = parsed as Record<string, unknown>;

    // Validate required string fields.
    for (const field of REQUIRED_STRING_FIELDS) {
      const v = obj[field];
      if (typeof v !== "string" || v.trim() === "") return null;
    }

    // Validate required array fields (non-empty arrays of non-empty strings).
    for (const field of REQUIRED_ARRAY_FIELDS) {
      const v = obj[field];
      if (!Array.isArray(v) || v.length === 0) return null;
      if (!v.every((item) => typeof item === "string" && item.trim().length > 0)) return null;
    }

    return {
      agentName: (obj["agentName"] as string).trim(),
      capability: (obj["capability"] as string).trim(),
      readSources: (obj["readSources"] as string[]).map((s) => s.trim()),
      output: (obj["output"] as string).trim(),
      commands: (obj["commands"] as string[]).map((s) => s.trim()),
      interfaces: (obj["interfaces"] as string[]).map((s) => s.trim()),
      measurableAcceptance: (obj["measurableAcceptance"] as string).trim(),
      failureMode: (obj["failureMode"] as string).trim(),
    };
  } catch {
    return null;
  }
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Run the concretize pass: call `infer` with a redacted prompt, parse the JSON response
 * into a `ConcreteAgentSpec`.
 *
 * Returns null on any failure (LLM error, parse error, missing/empty required field).
 * Never throws.
 *
 * @param payload  The council proposal payload (goal + findings + recommendation).
 * @param infer    The injected Claude-on-Max Infer function (system+user -> raw text).
 */
export async function concretizeCouncilToSpec(
  payload: CouncilProposalPayload,
  infer: Infer,
): Promise<ConcreteAgentSpec | null> {
  try {
    const prompt = buildConcretizePrompt(payload);
    const raw = await infer(prompt);
    if (!raw || raw.trim() === "") return null;
    return parseConcretizeResponse(raw);
  } catch {
    return null;
  }
}
