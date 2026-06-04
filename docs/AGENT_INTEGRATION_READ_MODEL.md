# Agent Integration Read Model (Phase 11I)

Read-only visibility of real agents (Ops, Fitness) inside the cockpit.

## Config-first

Copy `agent-integrations.example.json` to `agent-integrations.local.json`
(gitignored, local-only) and point the paths at your real agent repos:

```json
{
  "agents": [
    { "id": "ops-agent-v2", "name": "GECAN Ops AI", "type": "ops", "enabled": true,
      "repoPath": "../ops-agent-v2", "reportsPath": "../ops-agent-v2/reports",
      "handoverPath": "../ops-agent-v2/docs/HANDOVER.md", "readModel": { "mode": "local_files" } }
  ]
}
```

- `agent-integrations.local.json` is **gitignored** and never generated.
- `agent-integrations.example.json` contains **no secrets**.
- If the local config is missing, the cockpit still works and agents render as
  **unconfigured**. If a repo path is missing, the agent renders as **missing**.

## Boundaries

- **Agent integrations are read-only.** Adapters read only the configured local
  paths (repo, reports dir, handover doc).
- The cockpit **does not call Ops/Fitness internals directly**.
- No ClickUp mutation, no Apple Health mutation, no Google Drive mutation, no
  Supabase mutation, no Telegram.

## Output

`npm run agents:status` writes a report under `agent-integration-reports/`
listing configured/detected agents, missing sources, latest report paths, known
gaps, and the next recommended command. See
[OPS_FITNESS_AGENT_ADAPTERS.md](OPS_FITNESS_AGENT_ADAPTERS.md).
