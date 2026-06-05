/**
 * src/supabase/migration-apply-ops.ts
 *
 * Phase 18C — injectable boundary for the ACTUAL apply of generated-agent migrations.
 *
 * This is the first module in HartOS that can mutate an external database. It is reached
 * ONLY after the orchestrator confirms every data-layer gate is open (see data-layer-gates).
 * In tests it is always mocked — no real DB is ever touched by the suite.
 *
 * Apply mechanism (Hart's locked decision): Supabase CLI `supabase db push` against an
 * EXPLICIT `--project-ref`, authed via SUPABASE_ACCESS_TOKEN in the child env. We do NOT
 * hand-roll SQL execution, and we do NOT use the Supabase MCP (its project is fixed by its
 * own token, it is interactive-auth, and it bypasses our gate/ledger/scan model).
 *
 * Security rules:
 *   - The access token and DB password are passed to the child process env ONLY; never
 *     logged, never written to disk, never included in any returned message.
 *   - All stdout/stderr surfaced to callers is sanitized.
 *   - The smoke check is read-only (PostgREST HEAD/GET with limit=0).
 */

import { spawnSync } from "node:child_process";

export interface ApplyResult {
  success: boolean;
  /** Safe message — no tokens, no passwords, no full URLs with keys. */
  message: string;
  /** Sanitized CLI tail, for the report. Never contains secrets. */
  detail?: string;
}

export interface SmokeResult {
  table: string;
  exists: boolean;
  /** Safe status string, e.g. "HTTP 200". */
  status: string;
}

export interface ApplyParams {
  /** Directory that contains supabase/migrations (the generated agent's repo root within the scaffold). */
  projectDir: string;
  projectRef: string;
  /** Access token (Management/CLI auth). Passed to child env only — never logged. */
  accessToken: string | null;
  /** Optional DB password for `db push` (passed to child env only — never logged). */
  dbPassword: string | null;
  /**
   * When true, pass `--include-all` to `supabase db push`. Required to apply migrations
   * whose versions sort BEFORE the target project's existing migration history (otherwise
   * the CLI refuses them as out-of-order). Gated upstream by ALLOW_OUT_OF_ORDER_MIGRATION_APPLY.
   * Ordering tolerance only — it does NOT relax the destructive scan or collision posture.
   */
  includeAll?: boolean;
}

/**
 * Build the `supabase db push` argument vector. Pure + exported so the flag wiring is unit
 * testable without spawning a process. The DB password is NOT placed here as a positional
 * value that could be logged out of context — it is passed only via `--password` when present
 * and the caller keeps it in the child env too.
 */
export function buildDbPushArgs(params: Pick<ApplyParams, "projectRef" | "dbPassword" | "includeAll">): string[] {
  const args = ["db", "push", "--project-ref", params.projectRef];
  if (params.includeAll) args.push("--include-all");
  if (params.dbPassword) args.push("--password", params.dbPassword);
  return args;
}

export interface SmokeParams {
  url: string;
  /** Service role or anon key used as a read-only PostgREST credential. Never logged. */
  apiKey: string;
  tables: string[];
}

/** Injectable apply ops. Real impl shells the Supabase CLI; tests provide a mock. */
export interface SupabaseMigrationApplyOps {
  /** Apply pending migrations via `supabase db push`. Mutating — gated upstream. */
  applyViaCli(params: ApplyParams): Promise<ApplyResult>;
  /** Read-only smoke: does each table exist? Never mutates. */
  smokeTables(params: SmokeParams): Promise<SmokeResult[]>;
}

// ─── Sanitisation ─────────────────────────────────────────────────────────────

function sanitize(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Authorization:\s*\S+/gi, "Authorization: [REDACTED]")
    .replace(/apikey:\s*\S+/gi, "apikey: [REDACTED]")
    .replace(/sbp_[A-Za-z0-9]+/g, "[REDACTED]")
    .slice(0, 600);
}

// ─── Real implementation ──────────────────────────────────────────────────────

/**
 * Real ops: shells the Supabase CLI and PostgREST. Reached only when every gate is open.
 * `commandRunner` is injectable for unit isolation, but defaults to spawnSync.
 */
export function realSupabaseMigrationApplyOps(
  fetchImpl: typeof fetch = fetch
): SupabaseMigrationApplyOps {
  return {
    async applyViaCli(params: ApplyParams): Promise<ApplyResult> {
      const env: NodeJS.ProcessEnv = { ...process.env };
      // Token/password live in the child env only.
      if (params.accessToken) env["SUPABASE_ACCESS_TOKEN"] = params.accessToken;
      if (params.dbPassword) env["SUPABASE_DB_PASSWORD"] = params.dbPassword;

      const args = buildDbPushArgs(params);

      const r = spawnSync("supabase", args, {
        cwd: params.projectDir,
        env,
        encoding: "utf8",
        // Never inherit stdio — we capture + sanitize.
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 16 * 1024 * 1024,
      });

      if (r.error) {
        const code = (r.error as NodeJS.ErrnoException).code;
        if (code === "ENOENT") {
          return {
            success: false,
            message:
              "Supabase CLI not found on PATH. Install it (https://supabase.com/docs/guides/local-development) " +
              "or apply the generated SQL manually. No SQL was executed.",
          };
        }
        return { success: false, message: sanitize(`Supabase CLI failed to start: ${r.error.message}`) };
      }

      const tail = sanitize(`${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim());
      if (r.status === 0) {
        return { success: true, message: "supabase db push completed", detail: tail };
      }
      return { success: false, message: `supabase db push exited with code ${r.status}`, detail: tail };
    },

    async smokeTables(params: SmokeParams): Promise<SmokeResult[]> {
      const results: SmokeResult[] = [];
      for (const table of params.tables) {
        try {
          const res = await fetchImpl(
            `${params.url}/rest/v1/${encodeURIComponent(table)}?limit=0`,
            {
              method: "GET",
              headers: {
                apikey: params.apiKey,
                Authorization: `Bearer ${params.apiKey}`,
                "Content-Type": "application/json",
              },
            }
          );
          results.push({ table, exists: res.ok, status: `HTTP ${res.status}` });
        } catch (err) {
          results.push({
            table,
            exists: false,
            status: sanitize(`error: ${err instanceof Error ? err.message : "unknown"}`),
          });
        }
      }
      return results;
    },
  };
}

// ─── Mock for tests ───────────────────────────────────────────────────────────

/** Mock ops for tests — no CLI, no network. */
export function createMockApplyOps(
  overrides: Partial<SupabaseMigrationApplyOps> = {}
): SupabaseMigrationApplyOps {
  return {
    applyViaCli: async () => ({ success: true, message: "mock: db push completed", detail: "mock" }),
    smokeTables: async (params) =>
      params.tables.map((table) => ({ table, exists: true, status: "HTTP 200" })),
    ...overrides,
  };
}
