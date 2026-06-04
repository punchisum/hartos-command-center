/**
 * src/provisioning/trigger-local.ts
 *
 * Safe Trigger.dev API boundary for the provisioning engine.
 *
 * Security rules:
 *   - TRIGGER_SECRET_KEY is NEVER logged or included in messages.
 *   - Authorization headers are NEVER logged.
 *   - All error output is sanitized before inclusion in messages.
 *   - Only safe data (project ID, task names, HTTP status) is included in results.
 * Exported as an injectable interface so tests can mock Trigger operations.
 *
 * Phase 7E design:
 *   - `verifyProject`: calls Trigger.dev REST API to confirm key + project are valid.
 *   - `registerTask`:  returns manual_required — real registration requires Trigger CLI/SDK.
 *   - `listTasks`:     calls Trigger.dev REST API to list registered tasks.
 */

const DEFAULT_TRIGGER_API_URL = "https://api.trigger.dev";

export interface TriggerCommandResult {
  success: boolean;
  /** If true, action requires manual steps (e.g. CLI deploy). */
  manual?: boolean;
  /** Safe message — no secret key, no Authorization header. */
  message: string;
  /** Safe subset of result data. */
  data?: Record<string, unknown>;
}

/** Injectable interface for Trigger.dev operations. */
export interface TriggerOps {
  /**
   * Verify that the project is accessible with the given key.
   * Calls GET /api/v3/projects/{projectId} or equivalent.
   */
  verifyProject(projectId: string): Promise<TriggerCommandResult>;
  /**
   * List registered task names for the project.
   * Calls GET /api/v3/tasks or equivalent.
   */
  listTasks(projectId: string): Promise<TriggerCommandResult>;
  /**
   * Register/deploy tasks.
   * Real implementation returns manual_required — use Trigger CLI.
   * Mock implementation can return success for testing.
   */
  registerTasks(projectId: string): Promise<TriggerCommandResult>;
}

// ─── Output sanitisation ──────────────────────────────────────────────────────

function sanitize(msg: string): string {
  return msg
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Authorization:\s*\S+/gi, "Authorization: [REDACTED]")
    .slice(0, 200);
}

// ─── Real implementation factory ──────────────────────────────────────────────

/**
 * Create a real TriggerOps implementation.
 * The secret key is captured in closure — NEVER logged or included in messages.
 */
export function defaultTriggerOpsFactory(
  secretKey: string,
  apiUrl: string = DEFAULT_TRIGGER_API_URL,
  fetchImpl: typeof fetch = fetch
): TriggerOps {
  const base = apiUrl.replace(/\/$/, "");

  return {
    async verifyProject(projectId: string): Promise<TriggerCommandResult> {
      // Attempt to reach the Trigger.dev project endpoint.
      // The exact endpoint varies by Trigger.dev version; we try v3 first.
      try {
        const res = await fetchImpl(`${base}/api/v3/projects/${encodeURIComponent(projectId)}`, {
          method: "GET",
          headers: {
            // NEVER log this header value
            Authorization: `Bearer ${secretKey}`,
            "Content-Type": "application/json",
          },
        });

        if (res.ok) {
          return {
            success: true,
            message: `Trigger.dev project accessible (HTTP ${res.status})`,
            data: { projectId },
          };
        }
        if (res.status === 401) {
          return {
            success: false,
            message: "Trigger.dev auth failed (HTTP 401). Check TRIGGER_SECRET_KEY.",
          };
        }
        if (res.status === 404) {
          return {
            success: false,
            message: `Trigger.dev project not found (HTTP 404). Check TRIGGER_PROJECT_ID.`,
          };
        }
        return {
          success: false,
          message: `Trigger.dev project check failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `Trigger.dev network error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async listTasks(projectId: string): Promise<TriggerCommandResult> {
      try {
        // Attempt to list tasks via Trigger.dev API.
        const res = await fetchImpl(
          `${base}/api/v3/projects/${encodeURIComponent(projectId)}/tasks`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${secretKey}`,
              "Content-Type": "application/json",
            },
          }
        );

        if (res.ok) {
          const data = (await res.json()) as { data?: Array<{ slug?: string }> };
          const taskSlugs = (data.data ?? []).map((t) => t.slug ?? "unknown");
          return {
            success: true,
            message: `${taskSlugs.length} task(s) registered`,
            data: { taskSlugs },
          };
        }
        if (res.status === 404) {
          return {
            success: false,
            message: "No tasks found or endpoint not available (HTTP 404).",
          };
        }
        return {
          success: false,
          message: `Task list failed: HTTP ${res.status}`,
        };
      } catch (err) {
        return {
          success: false,
          message: sanitize(
            `Task list error: ${err instanceof Error ? err.message : "unknown"}`
          ),
        };
      }
    },

    async registerTasks(_projectId: string): Promise<TriggerCommandResult> {
      // Phase 7E: Real Trigger.dev task registration requires the Trigger CLI/SDK.
      // There is no simple REST endpoint to "register" tasks — tasks are deployed
      // via `npx trigger.dev@latest deploy` or the SDK's dev/build commands.
      return {
        success: false,
        manual: true,
        message:
          "Task registration requires the Trigger.dev CLI. " +
          "Run: npx trigger.dev@latest deploy",
        data: {
          instruction:
            "Option 1 — CLI:\n" +
            "  npx trigger.dev@latest deploy\n\n" +
            "Option 2 — CI/CD:\n" +
            "  Set TRIGGER_SECRET_KEY in your CI environment and run the deploy command.\n\n" +
            "Option 3 — Trigger.dev dashboard:\n" +
            "  Follow docs at https://trigger.dev/docs/deployment",
        },
      };
    },
  };
}

// ─── Mock factory for tests ───────────────────────────────────────────────────

/** Create a mock TriggerOps for tests. No real API calls are made. */
export function createMockTriggerOps(
  overrides: Partial<TriggerOps> = {}
): TriggerOps {
  return {
    verifyProject: async (projectId) => ({
      success: true,
      message: `Mock: Trigger.dev project "${projectId}" accessible`,
      data: { projectId },
    }),
    listTasks: async (_projectId) => ({
      success: true,
      message: "Mock: 2 task(s) registered",
      data: { taskSlugs: ["example-command", "scheduled-job"] },
    }),
    registerTasks: async (_projectId) => ({
      success: true,
      message: "Mock: tasks registered successfully",
      data: { deployed: true },
    }),
    ...overrides,
  };
}

/** Parse comma-separated task names from TRIGGER_EXPECTED_TASKS env var. */
export function parseExpectedTasks(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}
