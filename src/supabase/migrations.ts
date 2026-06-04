import { SupabaseLiveClient } from "./live-client.js";

export async function verifyCoreTables(client: SupabaseLiveClient): Promise<Record<string, boolean>> {
  return {
    debug_events: await client.tableExists("debug_events"),
    action_tokens: await client.tableExists("action_tokens"),
    command_events: await client.tableExists("command_events"),
  };
}
