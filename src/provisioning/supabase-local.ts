/**
 * src/provisioning/supabase-local.ts
 *
 * Safe Supabase provisioning boundary for the provisioning engine.
 *
 * Security rules:
 *   - SUPABASE_SERVICE_ROLE_KEY is NEVER logged or included in messages.
 *   - SUPABASE_ACCESS_TOKEN is NEVER logged or included in messages.
 *   - SUPABASE_DB_PASSWORD is NEVER logged or included in messages.
 *   - Authorization headers are NEVER logged.
 *   - All error output is sanitized before inclusion in messages.
 * Exported as an injectable interface so tests can mock Supabase operations.
 */

export interface SupabaseCommandResult {
  success: boolean;
  /** If true, the action cannot be automated — manual steps required. */
  manual?: boolean;
  /** Safe message — no keys, no tokens, no passwords. */
  message: string;
  /** Safe subset of result data. */
  data?: Record<string, unknown>;
}

/** Injectable interface for Supabase provisioning operations. */
export interface SupabaseOps {
  /** Check if a table exists in the Supabase project. Read-only. */
  tableExists(tableName: string): Promise<SupabaseCommandResult>;
  /**
   * Apply pending migrations.
   * Real implementation returns manual_required with instructions.
   * Mock implementation can return success for testing.
   */
  applyMigrations(
    migrationsDir: string,
    environment: string
  ): Promise<SupabaseCommandResult>;
  /**
   * Create a new Supabase project.
   * Real implementation returns manual_required.
   * Mock implementation can return success for testing.
   */
  createProject(params: {
    name: string;
    orgId: string;
    region: string;
  }): Promise<SupabaseCommandResult>;
}

// ─── Output sanitisation ──────────────────────────────────────────────────────

function sanitize(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Authorization:\s*\S+/gi, "Authorization: [REDACTED]")
    .replace(/apikey:\s*\S+/gi, "apikey: [REDACTED]")
    .slice(0, 200);
}

// ─── Real implementation factory ──────────────────────────────────────────────

/**
 * Create a real SupabaseOps implementation.
 * The service role key is captured in closure — never returned, logged, or included in messages.
 */
export function defaultSupabaseOpsFactory(
  supabaseUrl: string,
  serviceRoleKey: string,
  fetchImpl: typeof fetch = fetch
): SupabaseOps {
  return {
    async tableExists(tableName: string): Promise<SupabaseCommandResult> {
      try {
        // Use PostgREST: GET /rest/v1/{table}?limit=0
        // 200 = table exists, 404 = not found, other = error
        const res = await fetchImpl(
          `${supabaseUrl}/rest/v1/${encodeURIComponent(tableName)}?limit=0`,
          {
            method: "GET",
            headers: {
              // Key is used in header but NEVER logged
              apikey: serviceRoleKey,
              Authorization: `Bearer ${serviceRoleKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (res.ok) {
          return { success: true, message: `Table "${tableName}" exists` };
        }
        if (res.status === 404 || res.status === 400) {
          return {
            success: false,
            message: `Table "${tableName}" not found (HTTP ${res.status})`,
          };
        }
        return {
          success: false,
          message: `Table check failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `Table check error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async applyMigrations(
      migrationsDir: string,
      environment: string
    ): Promise<SupabaseCommandResult> {
      // Phase 7D: real migration apply is handled by the Phase 5 migration runner script.
      // Return manual_required with exact instructions — never execute SQL here.
      return {
        success: false,
        manual: true,
        message:
          `Migration apply requires manual action. ` +
          `Run: ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply`,
        data: {
          migrationsDir,
          environment,
          instruction:
            `Option 1 — Script: ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply\n` +
            `Option 2 — Supabase CLI: supabase db push\n` +
            `Option 3 — Dashboard: paste SQL into Supabase SQL editor`,
        },
      };
    },

    async createProject(params: {
      name: string;
      orgId: string;
      region: string;
    }): Promise<SupabaseCommandResult> {
      // Phase 7D: project creation via Management API is supported but returned as
      // manual_required because it requires SUPABASE_ACCESS_TOKEN and org configuration.
      // Real automation will be enabled in a later phase once org/token flow is hardened.
      return {
        success: false,
        manual: true,
        message:
          `Supabase project creation requires manual action. ` +
          `Create project at https://supabase.com/dashboard/new.`,
        data: {
          projectName: params.name,
          orgId: params.orgId,
          region: params.region,
          instruction:
            `1. Go to https://supabase.com/dashboard/new\n` +
            `2. Create project "${params.name}" in org "${params.orgId}" (region: ${params.region})\n` +
            `3. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the dashboard\n` +
            `4. Set SUPABASE_PROJECT_REF to the project reference ID`,
        },
      };
    },
  };
}

// ─── Mock factory for tests ───────────────────────────────────────────────────

/** Create a mock SupabaseOps for tests. No real API calls are made. */
export function createMockSupabaseOps(
  overrides: Partial<SupabaseOps> = {}
): SupabaseOps {
  return {
    tableExists: async (tableName) => ({
      success: true,
      message: `Mock: table "${tableName}" exists`,
    }),
    applyMigrations: async (_dir, _env) => ({
      success: true,
      message: "Mock: migrations applied successfully",
      data: { applied: 3 },
    }),
    createProject: async (params) => ({
      success: true,
      message: `Mock: project "${params.name}" created`,
      data: { projectRef: "mock-project-ref" },
    }),
    ...overrides,
  };
}
