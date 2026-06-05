/**
 * src/supabase/migration-apply-ops.ts
 *
 * Phase 18C — injectable boundary for the ACTUAL apply of generated-agent migrations.
 *
 * This is the first module in HartOS that can mutate an external database. It is reached
 * ONLY after the orchestrator confirms every data-layer gate is open (see data-layer-gates).
 * In tests it is always mocked — no real DB is ever touched by the suite.
 *
 * Apply mechanism (Hart's locked decision): Supabase CLI `supabase db push`, targeting the
 * project via `--db-url <connection-string>` (NOT `--project-ref` — that flag belongs to
 * `supabase link`, and passing it to db push fails). We do NOT hand-roll SQL execution, and we
 * do NOT use the Supabase MCP (its project is fixed by its own token, it is interactive-auth,
 * and it bypasses our gate/ledger/scan model).
 *
 * Security rules:
 *   - The access token is passed to the child env only; the db-url (which carries the DB
 *     password) is passed only as a CLI arg. Neither is logged, written to a report/ledger,
 *     or included in any returned message.
 *   - All stdout/stderr surfaced to callers is sanitized (incl. postgres:// URL redaction).
 *   - The smoke check is read-only (PostgREST HEAD/GET with limit=0).
 */

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

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
  /** Access token (Management/CLI auth — used for `supabase` API context). Child env only; never logged. */
  accessToken: string | null;
  /**
   * Database connection string for `supabase db push --db-url` — e.g.
   * postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres (percent-encoded).
   * This is a SECRET (contains the DB password). Passed only as a CLI arg; never logged,
   * never written to a report/ledger. `db push` selects its target via this URL — note that
   * the management access token ALONE cannot push migrations (it authenticates the API, not
   * the Postgres connection). Required for a real apply.
   */
  dbUrl: string | null;
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
 * testable without spawning a process.
 *
 * IMPORTANT: `supabase db push` does NOT accept `--project-ref` (that flag belongs to
 * `supabase link`). The target is selected via `--db-url <connection-string>`. The connection
 * string carries the password — callers must never log the returned argv.
 */
export function buildDbPushArgs(params: { dbUrl: string; includeAll?: boolean }): string[] {
  const args = ["db", "push", "--db-url", params.dbUrl];
  if (params.includeAll) args.push("--include-all");
  return args;
}

/**
 * Percent-encode a single userinfo component (username or password), preserving any existing
 * `%XX` escapes so the function is idempotent (safe to run on an already-encoded value).
 * Leaves characters that are valid in URL userinfo (unreserved + sub-delims) untouched and
 * encodes everything else — notably `< > / ? # [ ] : @` and whitespace. This is what fixes
 * raw special characters in DB passwords (e.g. `<`, `>`) that make the CLI's strict URL parser
 * reject the connection string with "invalid userinfo".
 */
function encodeUserinfoComponent(s: string): string {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    // Preserve an existing %XX escape so we never double-encode.
    if (c === "%" && /^[0-9A-Fa-f]{2}$/.test(s.slice(i + 1, i + 3))) {
      out += s.slice(i, i + 3);
      i += 2;
      continue;
    }
    const code = c.charCodeAt(0);
    if (code > 127) {
      out += encodeURIComponent(c); // multi-byte → UTF-8 percent-encoding
      continue;
    }
    // RFC 3986 unreserved + sub-delims are safe in userinfo; encode everything else.
    if (/[A-Za-z0-9\-._~!$&'()*+,;=]/.test(c)) {
      out += c;
      continue;
    }
    out += "%" + code.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/**
 * Normalize a Postgres connection string so `supabase db push --db-url` accepts it: percent-encode
 * the username/password while leaving scheme, host, port, path, and query untouched. Idempotent and
 * pure (no I/O). Returns the input unchanged if it has no recognizable scheme or no userinfo.
 * NEVER log the input or output — both carry the DB password.
 */
export function normalizeDbUrl(dbUrl: string): string {
  const m = /^(postgres(?:ql)?:\/\/)([\s\S]*)$/i.exec(dbUrl);
  if (!m) return dbUrl;
  const scheme = m[1]!;
  const rest = m[2]!;
  // Authority runs until the first '/' (path) or '?' (query); keep the remainder verbatim.
  const cut = [rest.indexOf("/"), rest.indexOf("?")].filter((i) => i >= 0);
  const end = cut.length ? Math.min(...cut) : rest.length;
  const authority = rest.slice(0, end);
  const tail = rest.slice(end);
  // Host can't contain '@', so the LAST '@' is the userinfo/host separator.
  const at = authority.lastIndexOf("@");
  if (at < 0) return dbUrl; // no userinfo → nothing to encode
  const userinfo = authority.slice(0, at);
  const hostport = authority.slice(at + 1);
  const colon = userinfo.indexOf(":");
  const user = colon >= 0 ? userinfo.slice(0, colon) : userinfo;
  const pass = colon >= 0 ? userinfo.slice(colon + 1) : null;
  const newUserinfo =
    pass === null
      ? encodeUserinfoComponent(user)
      : `${encodeUserinfoComponent(user)}:${encodeUserinfoComponent(pass)}`;
  return `${scheme}${newUserinfo}@${hostport}${tail}`;
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
    // DB connection strings first — they carry the password.
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "[REDACTED_DB_URL]")
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, "[REDACTED]")
    .replace(/Authorization:\s*\S+/gi, "Authorization: [REDACTED]")
    .replace(/apikey:\s*\S+/gi, "apikey: [REDACTED]")
    .replace(/sbp_[A-Za-z0-9]+/g, "[REDACTED]")
    .slice(0, 600);
}

/**
 * `supabase db push` requires a project context (supabase/config.toml) even with --db-url.
 * The generated scaffold ships supabase/migrations but no config.toml, so write a minimal one
 * (project_id only — NOT a secret) if absent. Idempotent; never overwrites an existing file.
 */
function ensureConfigToml(projectDir: string, projectRef: string): void {
  const dir = path.join(projectDir, "supabase");
  const file = path.join(dir, "config.toml");
  if (existsSync(file)) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, `project_id = "${projectRef}"\n`, "utf8");
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
      // db push needs a Postgres connection string. The management access token alone
      // cannot push migrations (it authenticates the API, not the DB connection).
      if (!params.dbUrl) {
        return {
          success: false,
          message:
            "supabase db push needs a database connection string. Set HARTOS_SUPABASE_DB_URL " +
            "(postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres). " +
            "The management access token alone cannot push migrations. No SQL was executed.",
        };
      }

      const env: NodeJS.ProcessEnv = { ...process.env };
      // Access token lives in the child env only (API context); the db-url/password is a CLI arg.
      if (params.accessToken) env["SUPABASE_ACCESS_TOKEN"] = params.accessToken;

      // db push requires project context even with --db-url; generate a minimal config.toml.
      ensureConfigToml(params.projectDir, params.projectRef);

      // Percent-encode userinfo so raw special chars in the password (e.g. < > !) don't make
      // the CLI's strict URL parser reject the connection string. Idempotent.
      const args = buildDbPushArgs({ dbUrl: normalizeDbUrl(params.dbUrl), includeAll: params.includeAll });

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
