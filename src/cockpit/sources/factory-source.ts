/**
 * src/cockpit/sources/factory-source.ts
 *
 * Phase 13D — read-only Factory source. Surfaces the freshness of the latest
 * factory verification, generated-agent verification, and build reports from
 * local report directories. Capability/module presence is supplied separately
 * (capability registry + runtime modules) by the Factory panel. Read-only.
 */

import type { SourceResult, SourceValue } from "./source-types.js";
import { emptyDiagnostics } from "./source-types.js";
import { computeFreshness, confidenceFor } from "./freshness.js";
import { summarizeValues } from "./layered.js";
import { findLatestReport } from "./local-report-source.js";

export const FACTORY_FIELD_KEYS = ["last_verification", "last_generated_verification", "last_build_report", "validation_counts", "last_cockpit_report"];

/** Extract `tests N / pass N / fail N` style counts from a report body, if any. */
function parseTestCounts(content: string): string | null {
  const tests = content.match(/#?\s*tests[:\s]+(\d+)/i);
  const pass = content.match(/#?\s*pass[:\s]+(\d+)/i);
  const fail = content.match(/#?\s*fail[:\s]+(\d+)/i);
  if (!tests && !pass) return null;
  const parts: string[] = [];
  if (tests) parts.push(`tests ${tests[1]}`);
  if (pass) parts.push(`pass ${pass[1]}`);
  if (fail) parts.push(`fail ${fail[1]}`);
  return parts.join(", ");
}

export const FACTORY_REPORT_DIRS = [
  "launch-reports", "production-reports", "bootstrap-reports", "cockpit-reports",
  "command-center-reports", "hartos-reports", "beezulbub-reports",
];

const VERIFY_STEP = "Run `npm run verify` (or a launch/bootstrap check) to produce a verification artefact.";

function valueFrom(rel: string, lastUpdated: string, now: string): SourceValue {
  const freshness = computeFreshness(lastUpdated, now);
  return { value: rel, source: "local-report", sourceType: "local_report", lastUpdated, freshness, confidence: confidenceFor("local_report", freshness) };
}

function finishFactory(values: Record<string, SourceValue>, checked: string[]): SourceResult {
  const summary = summarizeValues(values);
  const status: SourceResult["status"] = Object.keys(values).length === 0 ? "unavailable" : "available";
  const diagnostics = emptyDiagnostics();
  diagnostics.checked.push(...checked);
  diagnostics.notes.push(`resolved ${Object.keys(values).length} factory artefact(s)`);
  return {
    name: "factory",
    sourceType: status === "unavailable" ? "none" : summary.sourceType,
    status,
    lastUpdated: summary.lastUpdated,
    freshness: summary.freshness,
    confidence: summary.confidence,
    missingReason: status === "unavailable" ? "No verification/build report found." : null,
    setupStep: status === "unavailable" ? VERIFY_STEP : null,
    diagnostics,
    values,
  };
}

/** Pure fallback — no reports available in memory. */
export function deriveFactorySource(): SourceResult {
  return finishFactory({}, ["(none)"]);
}

export interface FactorySourceOptions {
  cwd: string;
  now: string;
  reportDirs?: string[];
}

export async function resolveFactorySource(options: FactorySourceOptions): Promise<SourceResult> {
  const { cwd, now } = options;
  const dirs = options.reportDirs ?? FACTORY_REPORT_DIRS;
  const values: Record<string, SourceValue> = {};

  const verification = await findLatestReport(cwd, dirs, /verify|launch|production|bootstrap|smoke|cockpit-snapshot/i);
  if (verification) {
    values["last_verification"] = valueFrom(verification.relativePath, verification.lastUpdated, now);
    const counts = parseTestCounts(verification.content);
    if (counts) values["validation_counts"] = { ...valueFrom(counts, verification.lastUpdated, now) };
  }

  const generated = await findLatestReport(cwd, dirs, /verify-generated|generated|smoke-local/i);
  if (generated) values["last_generated_verification"] = valueFrom(generated.relativePath, generated.lastUpdated, now);

  const build = await findLatestReport(cwd, dirs, /orchestrator|build|beezulbub|pack|capability/i);
  if (build) values["last_build_report"] = valueFrom(build.relativePath, build.lastUpdated, now);

  const cockpit = await findLatestReport(cwd, ["cockpit-reports"], /cockpit/i);
  if (cockpit) values["last_cockpit_report"] = valueFrom(cockpit.relativePath, cockpit.lastUpdated, now);

  return finishFactory(values, dirs);
}
