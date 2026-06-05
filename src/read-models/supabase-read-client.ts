/**
 * src/read-models/supabase-read-client.ts
 *
 * A STRICT read-only Supabase client. By construction it exposes NO mutation
 * methods — there is no insert/update/delete/upsert and no mutation RPC. It can
 * only:
 *   - select rows from an allowlisted table (GET via PostgREST), and
 *   - call an explicitly allowlisted read-only RPC (if any are configured).
 *
 * The key is read from config and sent only as an auth header; it is never
 * logged. A fetch implementation may be injected for tests so NO network call
 * occurs in the test suite.
 */

export interface SupabaseReadConfig {
  url: string;
  /** Read-only/anon key. Sent as a header only; never logged. */
  key: string;
  allowedTables: string[];
  allowedRpcs: string[];
}

export interface SelectOptions {
  limit?: number;
  /** Column to order by, e.g. "created_at". */
  order?: string;
  ascending?: boolean;
  /** Simple equality filters: { status: "open" }. */
  filter?: Record<string, string | number | boolean>;
  /** Columns to select; defaults to "*". */
  columns?: string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (url: string, init?: Record<string, unknown>) => Promise<FetchResponseLike>;

export class SupabaseReadError extends Error {
  /** PostgREST HTTP status when the failure came from a response (not allowlisting). */
  readonly status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.status = status;
  }
}

export class SupabaseReadClient {
  private readonly config: SupabaseReadConfig;
  private readonly fetchImpl: FetchLike;

  constructor(config: SupabaseReadConfig, fetchImpl?: FetchLike) {
    this.config = config;
    // Default to global fetch, but it is only ever reached for an allowlisted,
    // explicitly-enabled read. Tests inject a mock.
    //
    // IMPORTANT: bind to globalThis. Cloudflare Workers (workerd) throw
    // "Illegal invocation" if global fetch is stored detached and later called
    // with a different `this`. Node tolerates a detached fetch; workerd does not.
    const globalFetch = (globalThis as { fetch?: FetchLike }).fetch;
    this.fetchImpl =
      fetchImpl ??
      (typeof globalFetch === "function"
        ? (globalFetch.bind(globalThis) as FetchLike)
        : (globalFetch as unknown as FetchLike));
  }

  private headers(): Record<string, string> {
    return {
      apikey: this.config.key,
      authorization: `Bearer ${this.config.key}`,
      accept: "application/json",
    };
  }

  private assertTableAllowed(table: string): void {
    if (!this.config.allowedTables.includes(table)) {
      throw new SupabaseReadError(`Table "${table}" is not allowlisted for read access.`);
    }
  }

  /** Read rows from an allowlisted table. GET only — never mutates. */
  async select(table: string, options: SelectOptions = {}): Promise<Array<Record<string, unknown>>> {
    this.assertTableAllowed(table);
    if (typeof this.fetchImpl !== "function") {
      throw new SupabaseReadError("No fetch implementation available.");
    }
    const params = new URLSearchParams();
    params.set("select", options.columns ?? "*");
    if (typeof options.limit === "number") params.set("limit", String(options.limit));
    if (options.order) params.set("order", `${options.order}.${options.ascending ? "asc" : "desc"}`);
    for (const [k, v] of Object.entries(options.filter ?? {})) params.set(k, `eq.${v}`);

    const url = `${this.config.url.replace(/\/$/, "")}/rest/v1/${table}?${params.toString()}`;
    const res = await this.fetchImpl(url, { method: "GET", headers: this.headers() });
    if (!res.ok) throw new SupabaseReadError(`Read failed for "${table}" (status ${res.status}).`, res.status);
    const body = await res.json();
    return Array.isArray(body) ? (body as Array<Record<string, unknown>>) : [];
  }

  /** Call an explicitly allowlisted READ-ONLY RPC. Refuses anything else. */
  async readRpc(name: string, args: Record<string, unknown> = {}): Promise<unknown> {
    if (!this.config.allowedRpcs.includes(name)) {
      throw new SupabaseReadError(`RPC "${name}" is not allowlisted for read access.`);
    }
    if (typeof this.fetchImpl !== "function") {
      throw new SupabaseReadError("No fetch implementation available.");
    }
    const url = `${this.config.url.replace(/\/$/, "")}/rest/v1/rpc/${name}`;
    const res = await this.fetchImpl(url, {
      method: "POST",
      headers: { ...this.headers(), "content-type": "application/json" },
      body: JSON.stringify(args),
    });
    if (!res.ok) throw new SupabaseReadError(`RPC "${name}" failed (status ${res.status}).`, res.status);
    return res.json();
  }
}

// NOTE: This client exposes NO mutation methods. There are intentionally no
// insert/update/delete/upsert methods, and no mutation RPC helper. Mutation is
// impossible through this client by construction.
