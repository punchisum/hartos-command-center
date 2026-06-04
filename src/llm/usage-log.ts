/**
 * src/llm/usage-log.ts
 *
 * Safe, local usage logging for the LLM Gateway. Logs go under `llm-reports/`.
 * They record provider/model/mode/request-type/success/validation/timestamp —
 * never the API key, never the raw prompt, never the full source request.
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import type { LlmResult } from "./llm-types.js";
import { containsSecret, redactDeep } from "./redaction.js";

export const DEFAULT_LLM_REPORTS_DIR = "llm-reports";

export interface UsageLogRecord {
  timestamp: string;
  provider: string;
  model: string;
  mode: string;
  requestType: string;
  success: boolean;
  validation: string;
}

export function toUsageRecord(result: LlmResult, now: Date = new Date()): UsageLogRecord {
  return {
    timestamp: now.toISOString(),
    provider: result.provider,
    model: result.model,
    mode: result.mode,
    requestType: result.requestType,
    success: result.success,
    validation: result.validation,
  };
}

function renderMarkdown(record: UsageLogRecord): string {
  return [
    "# LLM Gateway Usage",
    "",
    `- timestamp: ${record.timestamp}`,
    `- provider: ${record.provider}`,
    `- model: ${record.model}`,
    `- mode: ${record.mode}`,
    `- request type: ${record.requestType}`,
    `- success: ${record.success}`,
    `- validation: ${record.validation}`,
    "",
    "_No secrets, raw prompts, or source request text are stored in this log._",
    "",
  ].join("\n");
}

/**
 * Write a usage log pair (.md + .json) under reportsDir. The record is deep
 * redacted as a defense-in-depth measure; if anything still looks like a secret
 * the write is refused.
 */
export async function writeUsageLog(
  reportsDir: string,
  result: LlmResult,
  now: Date = new Date()
): Promise<{ mdPath: string; jsonPath: string }> {
  const record = redactDeep(toUsageRecord(result, now));
  const md = renderMarkdown(record);
  const json = JSON.stringify(record, null, 2);
  if (containsSecret(md) || containsSecret(json)) {
    throw new Error("Refusing to write LLM usage log: secret-looking content detected.");
  }
  await mkdir(reportsDir, { recursive: true });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const mdPath = path.join(reportsDir, `llm-usage-${stamp}.md`);
  const jsonPath = path.join(reportsDir, `llm-usage-${stamp}.json`);
  await writeFile(mdPath, md, "utf8");
  await writeFile(jsonPath, json, "utf8");
  return { mdPath, jsonPath };
}
