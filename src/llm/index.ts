/**
 * src/llm/index.ts
 *
 * Public surface of the governed LLM Gateway (Phase 11I). Import the gateway
 * from here — never a provider directly.
 */

export * from "./llm-types.js";
export {
  LlmGateway,
  resolveLlmConfig,
  selectProviderMode,
  DEFAULT_MODEL,
} from "./llm-gateway.js";
export { validateLlmOutput } from "./output-validator.js";
export { redact, redactDeep, containsSecret, assertNoSecrets, SECRET_PATTERNS } from "./redaction.js";
export { deterministicProvider, deterministicOutput } from "./providers/deterministic-provider.js";
export { openAiProvider, OpenAiProviderError } from "./providers/openai-provider.js";
export {
  writeUsageLog,
  toUsageRecord,
  DEFAULT_LLM_REPORTS_DIR,
  type UsageLogRecord,
} from "./usage-log.js";
export {
  buildSystemPrompt,
  buildUserPrompt,
  OUTPUT_KEYS,
  ALLOWED_CONFIDENCE,
  ALLOWED_RISK,
} from "./prompt-contracts.js";
