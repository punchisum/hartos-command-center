import type { Env, TriggerEnqueue } from "../shared/types.js";
import { optionalEnv } from "../runtime/env.js";

export class TriggerHttpEnqueue implements TriggerEnqueue {
  constructor(private readonly env: Env, private readonly fetchImpl: typeof fetch = fetch) {}

  async enqueue(command: string, payload: Record<string, unknown>): Promise<void> {
    const secret = optionalEnv(this.env, "TRIGGER_SECRET_KEY");
    if (!secret) {
      throw new Error("Trigger is not configured. Missing TRIGGER_SECRET_KEY.");
    }

    void command;
    void payload;
    void this.fetchImpl;
    // Phase 4 boundary only. Add Trigger.dev SDK or HTTP endpoint wiring in Phase 5.
    throw new Error("Trigger enqueue boundary is configured but not registered. Follow docs/TRIGGER_RUNBOOK.md.");
  }
}
