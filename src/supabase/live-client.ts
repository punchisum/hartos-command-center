import type { CommandEventInput, DebugEventInput, Env, SupabaseClient } from "../shared/types.js";
import { requireEnv } from "../runtime/env.js";

export interface SupabaseFetchOptions {
  fetchImpl?: typeof fetch;
}

export class SupabaseLiveClient implements SupabaseClient {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly env: Env, options: SupabaseFetchOptions = {}) {
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async insertDebugEvent(event: DebugEventInput): Promise<void> {
    await this.insert("debug_events", {
      trace_id: event.traceId,
      runtime: event.runtime,
      route: event.route,
      stage: event.stage,
      outcome: event.outcome,
      failure_code: event.failureCode ?? null,
      metadata: event.metadata ?? {},
    });
  }

  async insertCommandEvent(event: CommandEventInput): Promise<void> {
    await this.insert("command_events", {
      trace_id: event.traceId,
      route: event.route,
      status: event.status,
      input_json: event.inputJson ?? {},
      result_json: event.resultJson ?? {},
    });
  }

  async tableExists(table: string): Promise<boolean> {
    const response = await this.request(`/rest/v1/${encodeURIComponent(table)}?select=*&limit=1`, {
      method: "GET",
    });
    return response.ok;
  }

  async insertSmokeDebugEvent(traceId: string): Promise<void> {
    await this.insert("debug_events", {
      trace_id: traceId,
      runtime: "local",
      route: "smoke.supabase",
      stage: "mutation",
      outcome: "ok",
      metadata: { smoke: true },
    });
  }

  private async insert(table: string, body: Record<string, unknown>): Promise<void> {
    const response = await this.request(`/rest/v1/${encodeURIComponent(table)}`, {
      method: "POST",
      headers: { Prefer: "return=minimal" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Supabase insert failed for ${table}: ${response.status}`);
    }
  }

  private async request(path: string, init: RequestInit): Promise<Response> {
    const url = requireEnv(this.env, "SUPABASE_URL").replace(/\/$/, "");
    const key = requireEnv(this.env, "SUPABASE_SERVICE_ROLE_KEY");
    return this.fetchImpl(`${url}${path}`, {
      ...init,
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
  }
}
