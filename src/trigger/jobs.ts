import type { Env, SupabaseClient } from "../shared/types.js";
import { runExampleCommand } from "./tasks/example-command.js";

export interface TriggerJobDeps {
  env: Env;
  supabase: SupabaseClient;
}

export async function handleCommandJob(
  command: string,
  payload: Record<string, unknown>,
  deps: TriggerJobDeps
): Promise<void> {
  await runExampleCommand(command, payload, deps);
}

export async function handleScheduledJob(name: string, deps: TriggerJobDeps): Promise<void> {
  await runExampleCommand(name, { scheduled: true }, deps);
}
