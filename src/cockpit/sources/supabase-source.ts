/**
 * src/cockpit/sources/supabase-source.ts
 *
 * Phase 13A — the optional Supabase read-only source contract. This is a thin,
 * read-only adapter over the existing Phase 11I `ReadModelSummary` (which itself
 * only ever uses `select()` — no mutation, no service-role key). It converts a
 * summary into the shared `SourceResult` envelope with freshness + confidence.
 */

import type { ReadModelSummary } from "../../read-models/read-model-types.js";
import type { SourceConfidence, SourceResult, SourceValue } from "./source-types.js";
import { emptyDiagnostics } from "./source-types.js";
import { computeFreshness, confidenceFor } from "./freshness.js";

/** Map a read-model status to a source status + a setup step when unavailable. */
function statusFor(rm: ReadModelSummary | undefined): { status: SourceResult["status"]; missingReason: string | null; setupStep: string | null } {
  if (!rm) return { status: "unavailable", missingReason: "No read-model configured for this domain.", setupStep: "Add a read-model entry to read-models.local.json (mode supabase_readonly)." };
  switch (rm.status) {
    case "ok":
      return { status: "available", missingReason: null, setupStep: null };
    case "degraded":
      return { status: "partial", missingReason: `Some sources degraded: ${rm.degradedSources.join(", ") || "unknown"}.`, setupStep: "Allowlist the missing tables in read-models.local.json." };
    case "disabled":
      return { status: "unavailable", missingReason: "Read-model disabled.", setupStep: "Set enabled=true for this read-model in read-models.local.json." };
    case "missing":
      return { status: "unavailable", missingReason: "Read-model enabled but env/client missing.", setupStep: "Set the Supabase URL + read-only (anon) key env vars." };
    case "error":
      return { status: "unavailable", missingReason: "Read-model errored (see read-model report).", setupStep: "Check the read-only Supabase boundary configuration." };
    default:
      return { status: "unavailable", missingReason: "Read-model unconfigured.", setupStep: "Configure read-models.local.json." };
  }
}

/** Convert a fitness/ops read-model summary into a generic SourceResult. */
export function supabaseSourceResult(name: string, rm: ReadModelSummary | undefined, now: string): SourceResult {
  const { status, missingReason, setupStep } = statusFor(rm);
  const lastUpdated = rm?.dataFreshness ?? null;
  const freshness = computeFreshness(lastUpdated, now);
  const confidence: SourceConfidence = rm && (rm.status === "ok" || rm.status === "degraded")
    ? confidenceFor("supabase_readonly", freshness)
    : "low";

  const values: Record<string, SourceValue> = {};
  if (rm && (rm.status === "ok" || rm.status === "degraded")) {
    for (const [k, v] of Object.entries(rm.metrics)) {
      if (k === "card") continue;
      values[k] = { value: String(v), source: `supabase:${rm.id}`, sourceType: "supabase_readonly", lastUpdated, freshness, confidence };
    }
  }

  const diagnostics = emptyDiagnostics();
  diagnostics.checked.push(rm ? `read-model:${rm.id}` : "read-model:(none)");
  if (rm) diagnostics.notes.push(`status=${rm.status}, degraded=[${rm.degradedSources.join(",")}]`);

  return { name, sourceType: "supabase_readonly", status, lastUpdated, freshness, confidence, missingReason, setupStep, diagnostics, values };
}
