# Ops & Fitness Agent Adapters (Phase 11I)

Both adapters are **read-only** and degrade safely when paths/config are missing.

## Ops Agent Adapter (`src/agents/ops-agent-adapter.ts`)

Reads only configured local paths. Surfaces cards:

- **Ops Agent — System Status** (repo detected?)
- **Ops Agent — Reports / Handover** (latest handover summary + report paths)
- **Ops Agent — Known Gaps** (missing local sources)
- **Ops Agent — Recent Activity** (most recent local mtime)

It does **not** call ClickUp, does **not** mutate Supabase, does **not** call
Telegram.

## Fitness Agent Adapter (`src/agents/fitness-agent-adapter.ts`)

Reads only configured local paths. Surfaces cards:

- **Fitness Agent — System Status**
- **Fitness Agent — Latest Briefing**
- **Fitness Agent — Recovery / Training Visibility**
- **Fitness Agent — Known Gaps**

It does **not** call Apple Health, does **not** call Google Drive, does **not**
mutate Supabase.

## Status values

`ok | degraded | missing | unconfigured | error` — a missing repo yields
`missing`, never a crash. No action surfaced by either adapter is executable.
