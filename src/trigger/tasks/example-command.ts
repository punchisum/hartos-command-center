import { InMemoryActionTokenStore, runApprovedAction } from "../../lib/action-tokens.js";
import { emitDebugEvent } from "../../lib/debug.js";
import type { Env, LlmProvider, SupabaseClient } from "../../shared/types.js";

export interface CommandTaskDeps {
  env: Env;
  supabase: SupabaseClient;
  llm?: LlmProvider;
}

export async function runExampleCommand(
  command: string,
  payload: Record<string, unknown>,
  deps: CommandTaskDeps
): Promise<void> {
  const traceId = String(payload.traceId ?? crypto.randomUUID());
  await emitDebugEvent(deps.env, deps.supabase, {
    traceId,
    runtime: "trigger",
    route: command,
    stage: "start",
    outcome: "ok",
    metadata: { command },
  });

  void deps.llm;
  // TODO: Execute command boundary. LLM and risky mutations belong here, never in Worker intake.
}

export async function runApprovedMutationPlaceholder(tok: string): Promise<void> {
  const store = new InMemoryActionTokenStore();
  await runApprovedAction(store, tok, async () => {
    // TODO: Apply approved external mutation, then consume token after success.
  });
}
