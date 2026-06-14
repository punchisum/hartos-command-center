/**
 * scripts/run-council-build-bridge.ts -- P7 Council->Factory bridge host glue (DISARMED).
 *
 * runCouncilBuildBridgeOnce(env, now):
 *   - DISARMED early-out: gate on HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE === "true" (default off).
 *     Returns [] without touching the DB or running the Factory.
 *   - No DB configured -> returns [].
 *   - Armed + DB: queries cockpit_proposals for simulated_approved council proposals,
 *     runs bridgeCouncilToFactory for each, upserts the resulting factory proposals.
 *     Idempotency: skips proposals whose factory counterpart already exists.
 *
 * === P7 concretize pass ===
 * Builds an `infer` via `selectCouncilInfer(env)` (Claude-on-Max when CLAUDE_CODE_OAUTH_TOKEN
 * is present, governed LlmGateway otherwise) and passes it into bridgeCouncilToFactory.
 * The bridge's concretize step converts strategic prose -> concrete Factory-buildable spec
 * before driving the manifest compiler + planner.
 *
 * PROPOSE-ONLY: produces pending_approval / executable:false factory build-plan proposals.
 * NEVER scaffolds, provisions, or auto-executes anything.
 * DISARMED gate unchanged: HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE must === "true".
 *
 * NODE EXECUTION HOST ONLY. Never the Worker. Never throws.
 */

import { pathToFileURL } from "node:url";
import { createCockpitProposalDb } from "../src/cockpit/proposals/supabase-proposal-db.js";
import { bridgeCouncilToFactory, makeFactoryProposalId } from "../src/hartos/council-factory-bridge.js";
import type { CouncilProposalPayload } from "../src/council/council-types.js";
import { selectCouncilInfer } from "../src/council/council-specialists.js";
import { redact } from "../src/llm/redaction.js";

type Env = Record<string, string | undefined>;

/** The arming gate env var for the council->factory bridge. */
export const COUNCIL_BUILD_BRIDGE_FLAG = "HARTOS_ALLOW_COUNCIL_BUILD_BRIDGE";

/** True only when the bridge is explicitly armed. Default is OFF (disarmed). */
export function councilBuildBridgeArmed(env: Env): boolean {
  return env[COUNCIL_BUILD_BRIDGE_FLAG] === "true";
}

/**
 * Run one council->factory bridge pass. DISARMED -> silent []. No DB -> silent [].
 *
 * When armed + DB configured:
 *   1. Query cockpit_proposals for domain='council' AND status='simulated_approved'.
 *   2. For each: parse proposedPayload as CouncilProposalPayload.
 *      Idempotency: skip if prop-factory-<suffix> already exists in cockpit_proposals.
 *   3. Build an infer via selectCouncilInfer(env) (Claude-on-Max or governed LlmGateway).
 *   4. Run bridgeCouncilToFactory (async, with infer); if ok -> upsert the factory proposal.
 *   5. Collect and return result lines.
 *
 * Never throws -- all errors are caught, redacted, and returned as log lines.
 * Always closes the DB handle.
 */
export async function runCouncilBuildBridgeOnce(env: Env, now: string): Promise<string[]> {
  // 1. Disarmed early-out.
  if (!councilBuildBridgeArmed(env)) return [];

  // 2. Open DB; no DB -> silent [].
  const h = createCockpitProposalDb(env as NodeJS.ProcessEnv);
  if (!h) return [];

  // Build the infer once per bridge run (Claude-on-Max or governed fallback).
  // Never throws -- selectCouncilInfer is safe to call regardless of env.
  const infer = selectCouncilInfer(env);

  const lines: string[] = [];

  try {
    // 3. Query approved council proposals.
    let rows: unknown[];
    try {
      const result = await h.query(
        "SELECT id, payload FROM cockpit_proposals WHERE domain = $1 AND status = $2",
        ["council", "simulated_approved"],
      );
      rows = result.rows ?? [];
    } catch (e) {
      lines.push(`council-build-bridge · db query error: ${redact(String(e instanceof Error ? e.message : e))}`);
      return lines;
    }

    if (rows.length === 0) {
      return [];
    }

    for (const row of rows) {
      const r = row as Record<string, unknown>;
      const councilProposalId = String(r["id"] ?? "");
      if (!councilProposalId) continue;

      // 4. Idempotency: skip if factory proposal already exists.
      const factoryId = makeFactoryProposalId(councilProposalId);
      try {
        const existing = await h.query(
          "SELECT id FROM cockpit_proposals WHERE id = $1",
          [factoryId],
        );
        if ((existing.rows ?? []).length > 0) {
          lines.push(`council-build-bridge · skipped (already exists) · ${factoryId}`);
          continue;
        }
      } catch (e) {
        lines.push(`council-build-bridge · idempotency check error for ${councilProposalId}: ${redact(String(e instanceof Error ? e.message : e))}`);
        continue;
      }

      // 5. Parse the council payload from the DB row.
      let councilPayload: CouncilProposalPayload;
      try {
        const rawPayload = r["payload"];
        // The DB stores the full row; proposedPayload is the council's CouncilProposalPayload.
        const parsed =
          typeof rawPayload === "string" ? JSON.parse(rawPayload) : rawPayload;
        // The council proposal stores its data in proposed_payload / proposedPayload.
        const inner =
          (parsed as Record<string, unknown>)?.["proposed_payload"] ??
          (parsed as Record<string, unknown>)?.["proposedPayload"] ??
          parsed;
        councilPayload = inner as CouncilProposalPayload;
        if (!councilPayload?.rootGoal || !councilPayload?.recommendation) {
          lines.push(`council-build-bridge · skipped (no rootGoal/recommendation in payload) · ${councilProposalId}`);
          continue;
        }
      } catch (e) {
        lines.push(`council-build-bridge · payload parse error for ${councilProposalId}: ${redact(String(e instanceof Error ? e.message : e))}`);
        continue;
      }

      // 6. Run the bridge (async, concretize pass + direct-spec Factory path).
      let result: Awaited<ReturnType<typeof bridgeCouncilToFactory>>;
      try {
        result = await bridgeCouncilToFactory(councilPayload, councilProposalId, now, infer);
      } catch (e) {
        lines.push(`council-build-bridge · bridge error for ${councilProposalId}: ${redact(String(e instanceof Error ? e.message : e))}`);
        continue;
      }

      if (!result.ok || !result.proposal) {
        lines.push(`council-build-bridge · refused · ${councilProposalId} · ${redact(result.reason)}`);
        continue;
      }

      // 7. Upsert the factory proposal.
      try {
        await h.store.upsert(result.proposal);
        lines.push(`council-build-bridge · proposal created · ${result.proposal.id} · council=${councilProposalId}`);
      } catch (e) {
        lines.push(`council-build-bridge · upsert error for ${councilProposalId}: ${redact(String(e instanceof Error ? e.message : e))}`);
      }
    }
  } catch (e) {
    lines.push(`council-build-bridge · unexpected error: ${redact(String(e instanceof Error ? e.message : e))}`);
  } finally {
    try {
      await h.close();
    } catch {
      // best-effort close
    }
  }

  return lines;
}

// -- CLI entry point ────────────────────────────────────────────────────────────
const isMain =
  typeof process.argv[1] === "string" &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const now = new Date().toISOString();
  runCouncilBuildBridgeOnce(process.env, now)
    .then((lines) => {
      for (const l of lines) console.log(l);
    })
    .catch((err) => {
      console.error(
        `council-build-bridge failed: ${redact(err instanceof Error ? err.message : String(err))}`,
      );
      process.exit(1);
    });
}
