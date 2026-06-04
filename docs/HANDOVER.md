# Handover

Runtime skeleton and provider wiring generated.

Next steps:

1. Review `agent.yaml` command ownership and approval policy.
2. Implement Supabase client writes for `debug_events`, `command_events`, and `action_tokens`.
3. Apply Supabase migrations manually or through approved CI/CD.
4. Wire Cloudflare Worker deployment config from `wrangler.toml.example`.
5. Register Telegram webhook only after local and staging smoke tests pass.
6. Decide whether Trigger.dev SDK or HTTP enqueue should be wired in Phase 5.
7. Keep all real secrets outside the repo.
