import type { CommandEventInput, DebugEventInput, Env, SupabaseClient } from "../shared/types.js";
import { SupabaseLiveClient } from "./live-client.js";

export class SupabaseHttpClient implements SupabaseClient {
  private readonly liveClient: SupabaseLiveClient;

  constructor(private readonly env: Env) {
    this.liveClient = new SupabaseLiveClient(env);
  }

  async insertDebugEvent(event: DebugEventInput): Promise<void> {
    this.assertConfigured();
    await this.liveClient.insertDebugEvent(event);
  }

  async insertCommandEvent(event: CommandEventInput): Promise<void> {
    this.assertConfigured();
    await this.liveClient.insertCommandEvent(event);
  }

  private assertConfigured(): void {
    if (!this.env.SUPABASE_URL || !this.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error("Supabase env vars are not configured");
    }
  }
}
