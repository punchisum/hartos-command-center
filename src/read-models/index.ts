/**
 * src/read-models/index.ts
 *
 * Public surface for read-only real-data integration (Phase 11I). The Supabase
 * read client exposes NO mutation methods.
 */

export * from "./read-model-types.js";
export {
  loadReadModelRegistry,
  resolveAvailability,
  isReadModelLive,
  LOCAL_CONFIG_FILE,
  EXAMPLE_CONFIG_FILE,
  type LoadedReadModelRegistry,
} from "./read-model-registry.js";
export {
  SupabaseReadClient,
  SupabaseReadError,
  type SupabaseReadConfig,
  type SelectOptions,
  type FetchLike,
} from "./supabase-read-client.js";
export { buildOpsReadModelSummary } from "./ops-read-model.js";
export { buildFitnessReadModelSummary } from "./fitness-read-model.js";
export {
  buildReadModelRegistrySummary,
  renderReadModelReportMarkdown,
  writeReadModelReport,
  DEFAULT_READ_MODEL_REPORTS_DIR,
  type ReadModelRegistryOptions,
  type ClientFactory,
} from "./read-model-report.js";
