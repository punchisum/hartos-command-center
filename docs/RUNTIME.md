# Runtime

Cloudflare Worker owns webhook intake, Telegram auth, payload normalization, callback_data intake, fast responses, and enqueue placeholders.

Trigger.dev owns command execution, scheduled work, LLM boundaries, approved mutation placeholders, debug writes, and action token consume-after-success behavior.

Supabase owns source-of-truth state: `agent_runs`, `command_events`, `debug_events`, and `action_tokens`.

Provider calls are available only through explicit boundaries:

- `src/supabase/live-client.ts`
- `src/telegram/sender.ts`
- `src/telegram/register-webhook.ts`
- `src/trigger/enqueue.ts`
- `src/runtime/env.ts`

Local smoke tests do not require secrets. Live mutation smoke is gated by `ALLOW_LIVE_SMOKE_MUTATION=true`.
