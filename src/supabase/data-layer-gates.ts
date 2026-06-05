/**
 * src/supabase/data-layer-gates.ts
 *
 * Phase 18C — gate matrix for the first real data-layer mutation (generated-agent
 * Supabase migration apply to an EXPLICITLY selected existing test project).
 *
 * Pure module: reads a plain env record, returns a verdict. No fs, no network.
 *
 * Posture (stricter than the command-center's own 2-gate migrations:apply, on purpose —
 * this is the first external DB mutation in the system):
 *   ALL of the following must hold for a single apply:
 *     - ALLOW_SUPABASE_MIGRATION_APPLY = "true"
 *     - CONFIRM_DATA_LAYER_MUTATION   = "true"
 *     - HARTOS_SUPABASE_PROJECT_REF   set (the one project we will touch)
 *     - CONFIRM_SUPABASE_TARGET_PROJECT === HARTOS_SUPABASE_PROJECT_REF  (typo guard:
 *       you confirm the literal ref, not just "yes")
 *     - HARTOS_TARGET_ENV ∈ {staging, test}
 *     - HARTOS_SUPABASE_URL set and consistent with the project ref (no A/B mismatch)
 *   With ANY of these missing/closed → dry-run only (the orchestrator mutates nothing).
 *
 * Production is HARD-REFUSED in 18C unconditionally (Hart's locked decision): a
 * production env label is blocked even if a production-confirm gate were set. Prod apply
 * is deferred to a later phase. This module surfaces that as a hard block, not a gate.
 */

export const APPLY_GATE = "ALLOW_SUPABASE_MIGRATION_APPLY";
export const MUTATION_CONFIRM_GATE = "CONFIRM_DATA_LAYER_MUTATION";
export const TARGET_CONFIRM_GATE = "CONFIRM_SUPABASE_TARGET_PROJECT";
export const DESTRUCTIVE_OVERRIDE_GATE = "ALLOW_DESTRUCTIVE_SQL";
/**
 * Opt-in ordering tolerance. When open, the apply passes `--include-all` to `supabase db push`,
 * allowing migrations whose versions sort BEFORE the target project's existing migration history
 * to be applied (the CLI otherwise refuses them as out-of-order). This is an ordering concern
 * ONLY — it does not relax the destructive scan, collision posture, or any other gate.
 */
export const ORDER_TOLERANCE_GATE = "ALLOW_OUT_OF_ORDER_MIGRATION_APPLY";

export const PROJECT_REF_KEY = "HARTOS_SUPABASE_PROJECT_REF";
export const URL_KEY = "HARTOS_SUPABASE_URL";
export const ACCESS_TOKEN_KEY = "HARTOS_SUPABASE_ACCESS_TOKEN";
export const DB_PASSWORD_KEY = "HARTOS_SUPABASE_DB_PASSWORD";
export const TARGET_ENV_KEY = "HARTOS_TARGET_ENV";

export type DataLayerTargetEnv = "staging" | "test";
const ALLOWED_ENVS: readonly string[] = ["staging", "test"];

export interface DataLayerGateConfig {
  /** True only when every gate/key required for a real apply is present and consistent. */
  allowApply: boolean;
  /** True when the destructive-SQL override gate is open. */
  allowDestructive: boolean;
  /** True when ordering tolerance is opted in (passes --include-all to db push). */
  allowOutOfOrder: boolean;
  /** Hard block (e.g. production label) — apply is refused regardless of gates. */
  hardBlock: string | null;
  /** Human-readable names/values of what's missing for a real apply (empty = ready). */
  missing: string[];
  /** Resolved selection (safe — no secrets). */
  projectRef: string | null;
  url: string | null;
  targetEnv: string | null;
  /** Whether an access token / db password were provided (booleans only — never the values). */
  hasAccessToken: boolean;
  hasDbPassword: boolean;
}

/** Extract the project ref embedded in a Supabase URL (https://<ref>.supabase.co). */
export function refFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = /^https?:\/\/([a-z0-9]+)\.supabase\.(co|in|net)\b/i.exec(url.trim());
  return m ? m[1]!.toLowerCase() : null;
}

export function readDataLayerGates(env: Record<string, string | undefined>): DataLayerGateConfig {
  const missing: string[] = [];

  const applyGate = env[APPLY_GATE] === "true";
  const mutationConfirm = env[MUTATION_CONFIRM_GATE] === "true";
  const projectRef = env[PROJECT_REF_KEY]?.trim() || null;
  const targetConfirm = env[TARGET_CONFIRM_GATE]?.trim() || null;
  const url = env[URL_KEY]?.trim() || null;
  const targetEnv = env[TARGET_ENV_KEY]?.trim().toLowerCase() || null;
  const accessToken = env[ACCESS_TOKEN_KEY]?.trim() || null;
  const dbPassword = env[DB_PASSWORD_KEY]?.trim() || null;

  // ── Hard block: production label is refused in 18C, full stop. ──
  let hardBlock: string | null = null;
  if (targetEnv === "production" || targetEnv === "prod") {
    hardBlock =
      `${TARGET_ENV_KEY}=${targetEnv} is refused in Phase 18C. Production data-layer apply is ` +
      `deferred to a later phase. Use a staging/test project only.`;
  }

  // ── Gate/key presence ──
  if (!applyGate) missing.push(`${APPLY_GATE}=true`);
  if (!mutationConfirm) missing.push(`${MUTATION_CONFIRM_GATE}=true`);
  if (!projectRef) missing.push(PROJECT_REF_KEY);

  // Target-confirm must equal the project ref exactly (typo guard).
  if (!targetConfirm) {
    missing.push(`${TARGET_CONFIRM_GATE}=<project_ref>`);
  } else if (projectRef && targetConfirm !== projectRef) {
    missing.push(
      `${TARGET_CONFIRM_GATE} must equal ${PROJECT_REF_KEY} exactly (got a different value — refusing to guess)`
    );
  }

  // Env label must be staging|test.
  if (!targetEnv) {
    missing.push(`${TARGET_ENV_KEY}=staging|test`);
  } else if (!ALLOWED_ENVS.includes(targetEnv) && hardBlock === null) {
    missing.push(`${TARGET_ENV_KEY} must be one of: ${ALLOWED_ENVS.join(", ")} (got "${targetEnv}")`);
  }

  // URL present + consistent with the project ref (no pointing URL at project A while
  // confirming project B). Only enforce consistency when the URL encodes a ref.
  if (!url) {
    missing.push(URL_KEY);
  } else {
    const urlRef = refFromUrl(url);
    if (projectRef && urlRef && urlRef !== projectRef.toLowerCase()) {
      missing.push(
        `${URL_KEY} points at project "${urlRef}" but ${PROJECT_REF_KEY} is "${projectRef}" — refusing on mismatch`
      );
    }
  }

  const allowApply = hardBlock === null && missing.length === 0;

  return {
    allowApply,
    allowDestructive: env[DESTRUCTIVE_OVERRIDE_GATE] === "true",
    allowOutOfOrder: env[ORDER_TOLERANCE_GATE] === "true",
    hardBlock,
    missing,
    projectRef,
    url,
    targetEnv,
    hasAccessToken: Boolean(accessToken),
    hasDbPassword: Boolean(dbPassword),
  };
}

/** Names of every gate this phase understands, for display/summary. */
export function dataLayerGateNames(): string[] {
  return [APPLY_GATE, MUTATION_CONFIRM_GATE, TARGET_CONFIRM_GATE, DESTRUCTIVE_OVERRIDE_GATE, ORDER_TOLERANCE_GATE];
}
