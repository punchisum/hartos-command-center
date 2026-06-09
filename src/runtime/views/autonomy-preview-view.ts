/**
 * src/runtime/views/autonomy-preview-view.ts
 *
 * 3-levels-up master plan L3-3C capstone, made VISIBLE + HONEST — a PURE, read-only
 * cockpit view-builder that surfaces what the GATED autonomy loop (src/tasks/autonomy-loop.ts)
 * WOULD queue from the live cross-system suggestions, and nothing more.
 *
 * The autonomy loop can REASON and PROPOSE but is structurally INCAPABLE of approving or
 * executing (its `AutonomyActor` type excludes "executor"; the human-approval floor is
 * enforced by construction in `proposeTasksFromSuggestions`, which mints every task in the
 * initial `queued` status with `requiredApproval: "Hart"`). This view simply PROJECTS that
 * proposal set so Hart can SEE the floor: every previewed task is `queued` + Hart-gated, with
 * an explicit note that the loop NEVER approves or executes — Hart does.
 *
 * It REUSES the canon, never reimplementing it:
 *   - `cockpitSuggestions(state, now)` derives the SAME ranked SuggestedAction[] the landing
 *     page renders and the persist route writes — no second derivation of the suggestions.
 *   - `proposeTasksFromSuggestions(...)` (the autonomy loop's pure proposer) turns those
 *     suggestions into the queued, Hart-gated tasks — the exact records the loop would mint.
 *
 * Everything here is read-only and deterministic: it derives a view from the pre-built
 * snapshot and the INJECTED `now` string. No filesystem, no network, no env, no service-role
 * key, no ambient clock, no mutation, no execution. `executable` stays the literal
 * `"disabled"`. It mirrors the honest `{ available, mode, executable, note, ... }` shape +
 * available/unavailable branching of `mutationCenterView` / `fleetBriefingView`.
 *
 * Worker-safe by construction: the only VALUE import that reaches heavy code is
 * `cockpitSuggestions` (already imported by the read-only Worker) and the autonomy loop's pure
 * proposer (which value-imports only the pure task lifecycle — no fs/path/pg/crypto). Every
 * domain/task shape is `import type`.
 */

import type { CockpitState } from "../../cockpit/cockpit-types.js";
import { cockpitSuggestions } from "../cloudflare-cockpit-views.js";
import { proposeTasksFromSuggestions } from "../../tasks/autonomy-loop.js";
import type { AgentTask } from "../../tasks/agent-task-types.js";

/**
 * One previewed proposal — the read-only projection of a task the autonomy loop WOULD queue.
 * It carries ONLY the floor-visible facts: the task is always `queued` and always
 * Hart-gated, plus its domain/type/title for context. It is NOT executable and not a button.
 */
export interface AutonomyPreviewItem {
  id: string;
  title: string;
  /** Always "queued" — the initial status every proposed task is born in. The floor, visible. */
  status: "queued";
  /** Always "Hart" — the human-approval floor on every proposed task. */
  requiredApproval: "Hart";
  domain: AgentTask["domain"];
  taskType: AgentTask["taskType"];
}

/**
 * The read-only Autonomy Preview view-model. When the snapshot is present the view is
 * `available: true` and carries the previewed proposals (each `queued` + Hart-gated). When no
 * snapshot is present it is an honest `available: false` with a note — mirroring the
 * `available:false` branch of `mutationCenterView` / `fleetBriefingView`. Never fabricated:
 * no snapshot ⇒ honest unavailable, not an invented preview. `executable` is always the literal
 * `"disabled"`.
 */
export type AutonomyPreviewView =
  | {
      available: true;
      mode: "read_only_snapshot";
      executable: "disabled";
      /** The honest, always-true floor note: the loop proposes; it never approves/executes. */
      note: string;
      /** Count of proposals the loop WOULD queue from the live suggestions. */
      total: number;
      proposals: AutonomyPreviewItem[];
    }
  | {
      available: false;
      mode: "local_only";
      executable: "disabled";
      note: string;
      total: 0;
      proposals: [];
    };

/** The floor note shown on the available view — true regardless of how many proposals exist. */
const FLOOR_NOTE =
  "Preview only: these are the tasks the gated autonomy loop WOULD propose from the live " +
  "suggestions. Every one is born 'queued' with requiredApproval 'Hart'. The loop CANNOT " +
  "approve or execute anything — only Hart approves, and execution is a separate gated step.";

/**
 * PURE. Project the read-only Autonomy Preview from a cockpit snapshot + the injected `now`.
 *
 * - When `state` is present: derive the live suggestions via `cockpitSuggestions(state, now)`
 *   (the SAME set the page renders), feed them to `proposeTasksFromSuggestions(..., { now })`
 *   (the autonomy loop's pure proposer), and project each proposed task to its floor-visible
 *   facts: status (always "queued"), requiredApproval (always "Hart"), id/title/domain/taskType.
 *   Returns `available: true` with `executable: "disabled"` and the always-true floor note —
 *   even when there are zero suggestions (an honest empty preview, never fabricated).
 * - When `state` is absent: returns the honest `available: false` shell (mirrors the views'
 *   unavailable branch). No fabricated proposals.
 *
 * Deterministic: same snapshot + same `now` ⇒ deep-equal output (no clock/random/env; `now`
 * is injected and passed straight through to the pure proposer). No I/O, no mutation, no
 * execution.
 */
export function autonomyPreviewView(
  state: CockpitState | undefined,
  now: string,
): AutonomyPreviewView {
  if (!state) {
    return {
      available: false,
      mode: "local_only",
      executable: "disabled",
      note:
        "Autonomy preview is unavailable — no cockpit snapshot is resolved. The autonomy " +
        "loop proposes from the live suggestions; with no snapshot there is nothing to " +
        "reason over. Configure the live read-model env on the Worker, then re-bake the " +
        "snapshot. (Even when available, the loop never approves or executes — Hart does.)",
      total: 0,
      proposals: [],
    };
  }

  // The SAME ranked, de-duplicated suggestion set the landing page renders + the persist
  // route writes — derived once, read-only. (Empty when the intelligence is clear.)
  const suggestions = cockpitSuggestions(state, now).actions;

  // The autonomy loop's pure proposer: every task is born "queued" with requiredApproval
  // "Hart". We do NOT pass risks/authorizingProposalIds — the preview surfaces only what the
  // loop would queue from the visible suggestions, exactly and honestly.
  const proposed = proposeTasksFromSuggestions(suggestions, { now });

  // Project to floor-visible facts only. status/requiredApproval are RE-ASSERTED from the
  // task (not hard-coded), so the projection cannot silently launder a non-queued/non-Hart
  // task into the preview — if the loop ever produced one, the type would reject it here.
  const proposals: AutonomyPreviewItem[] = proposed.map((t) => ({
    id: t.id,
    title: t.title,
    status: assertQueued(t.status),
    requiredApproval: t.requiredApproval,
    domain: t.domain,
    taskType: t.taskType,
  }));

  return {
    available: true,
    mode: "read_only_snapshot",
    executable: "disabled",
    note: FLOOR_NOTE,
    total: proposals.length,
    proposals,
  };
}

/**
 * The floor, asserted at the projection boundary: a proposed task MUST be "queued". The
 * autonomy loop only ever mints "queued" tasks, so this is an identity in practice — but
 * asserting it here makes the floor structurally visible and refuses to project anything the
 * loop should never have produced (e.g. an approved/executor-only status), failing loud
 * rather than laundering it into a read-only surface.
 */
function assertQueued(status: AgentTask["status"]): "queued" {
  if (status !== "queued") {
    throw new Error(
      `autonomy preview floor violated: a proposed task was '${status}', expected 'queued' ` +
        "(the autonomy loop must never produce an approved/executor task)",
    );
  }
  return status;
}
