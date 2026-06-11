# HartOS — Session Handover (2026-06-10)

A fresh session should read this first, then `memory/MEMORY.md` + `memory/hartos-organism-patch.md`.

## Live state (deployed + working)

- **Cockpit Worker is LIVE**: https://hartos-command-center.hartos.workers.dev — `/health` reports
  `version` (git short SHA) + `builtAt`. Current live SHA at handover: **69f284b** (neon/glass theme).
- **Live LLM**: gpt-5.5 armed (HARTOS_LLM_PROVIDER=openai + network + OPENAI_API_KEY secret set).
- **Daily autopilot pulse**: Windows Scheduled Task "HartOS Autopilot Pulse" @ 07:00 (+ "HartOS Memory
  Heartbeat" @ 21:00). Runs ONLY when the home PC is on.
- **Cockpit features shipped this session**: Today's Decisions (Chief-of-Staff synthesis), Autopilot
  Pulse tile + forecast-accuracy, intent-specialized Ask (strategy/CTO), mobile + a11y, freshness
  stamp, deploy provenance in /health, neon/glass theme, Wolverine SENSE→PROPOSE in the pulse.
- **Git**: branch `feat/agent-runtime-provision-18d`, fully PUSHED to origin (punchisum/hartos-command-center).
- **Supabase**: "Hart Personal Core" = `xbuinrnpfjltimofwrdx` (cockpit_proposals/threads/memory_snapshots/
  pulse_runs + fitness); "GECAN OPS AGENT" = `tbdkveyixqjksamcdemr`.

## ⭐ NEXT TASK: turn ON real execution (approve → runner executes for real)

Hart wants: approve a proposal in the cockpit and have HartOS actually DO it (e.g. run a report,
move a ClickUp card). The spine is BUILT; it is gated OFF by doctrine. Activation, done LIVE with
Hart watching the first one:

**The loop (already built):**
1. Cockpit **Approve** button → `/api/proposals/transition` → `transitionCockpitProposal` →
   proposal status `pending_approval` → `simulated_approved`. **This already works live** (Hart's Key 1).
2. Two executors consume `simulated_approved` rows (run on the PC / a runner):
   - **`scripts/hartos-runner.ts`** (`npm run hartos:runner`) — executes `agent_job` proposals
     (beezulbub.hunt / research.brief / memory.capture) under per-action gates
     (BEEZULBUB_ALLOW_NETWORK, HARTOS_RESEARCH_GATHER, HARTOS_MEMORY_CAPTURE…).
   - **`scripts/run-spine-executor.ts`** (`npm run execute:cockpit-approved` / check package.json) —
     executes MUTATION adapters (ClickUp move/comment, reject/archive/mark/refresh) under per-adapter
     **ALLOW_EXEC_* flags (default OFF)** + a capability token / the elevated DB credential. It bumps
     each row to `EXECUTABLE_FROM` then runs `executeApprovedProposals` through the gated dispatch.
3. On a real write → status → `executed` + a `cockpit_proposal_audit` row (idempotent CAS this session).

**To make it real (the deliberate, watched steps):**
- Decide WHICH action to enable first. Real-mutation gates (default OFF), per adapter:
  `ALLOW_EXEC_CLICKUP_MOVE`, `ALLOW_EXEC_CLICKUP_COMMENT`, `ALLOW_EXEC_REJECT_DRAFTS`,
  `ALLOW_EXEC_ARCHIVE_REJECTED`, `ALLOW_EXEC_MARK_REVIEWED`, `ALLOW_EXEC_REFRESH_SYNC`.
- Provide the write credential (elevated `HARTOS_SUPABASE_DB_URL` and/or the ClickUp token in .env.local).
- Approve ONE proposal in the cockpit, then run the executor with ONLY that gate armed, e.g.
  `ALLOW_EXEC_CLICKUP_MOVE=true npm run execute:cockpit-approved -- --max 1` — watch it, confirm the
  audit row, confirm the real change. THEN widen.
- Safety: arming a gate + running the executor performs REAL changes. Do it on ONE proposal first,
  with Hart present. Never arm all gates blind.

**"Run a report" gap:** executable proposals today are MUTATION adapters + the agent_job kinds. A
research report ≈ the `research.brief` agent_job (runner executes `runResearch`). A generic
"run report X and file it" proposal type does NOT exist yet — net-new: add a `report` agent-job kind
(src/jobs/agent-job.ts) + a runner handler (scripts/hartos-runner.ts) that generates + files the
report. Spec with Hart before building (which report? where filed?).

## Linking the Obsidian MCP

HartOS already WRITES to the vault via a gated file writer (ALLOW_OBSIDIAN_WRITE) using
`HARTOS_OBSIDIAN_VAULT_PATH` — no MCP needed for that. "Link the Obsidian MCP" = give THIS Claude
Code session MCP access to the vault. Two options:

- **Simplest (recommended): a filesystem MCP pointed at the vault.**
  `claude mcp add obsidian-vault -- npx -y @modelcontextprotocol/server-filesystem "<HARTOS_OBSIDIAN_VAULT_PATH>"`
  Gives read/write to the vault as files (how HartOS already treats it). No Obsidian plugin needed.
- **Richer: a dedicated Obsidian MCP** (search/tags/links). Install the **Local REST API** community
  plugin in Obsidian → enable → copy its API key, then add an Obsidian MCP server (e.g. `mcp-obsidian`
  — confirm the current package) with the host + API key. Then `claude mcp list` to verify.

After adding, restart the session / run `claude mcp list`; the tools appear as `mcp__obsidian__*`.

## Path to 100% (remaining, from the honest scorecard)

- ✅ Keystone (headless push) — DONE (Hart pushed from home).
- ☁️ Always-on: move the pulse to Trigger.dev cloud cron + Telegram alerts (precedent:
  hart-os-fitness-trigger). Needs a `trigger deploy` + secrets (incl. a Telegram bot token — NOT in
  this repo's .env.local). The daily-habit pillar.
- ▶️ Execution loop (above) — the headline.
- ✈️ New domains (Travel etc.): `npm run factory:birth -- "build a X agent"` prints the full gated
  runway; the real work is the data source + a cockpit adapter (mirror src/cockpit/sources/fitness-source.ts).
- 🗣️ Voice — not started.
- ⏳ Memory depth — accrues daily via the pulse (needs ≥3 distinct-day snapshots; do NOT fake).

## Key commands

- Test: `npm test` (node:test, ~2415 passing). Bundle-check: `npm run cockpit:cloudflare:bundle-check`.
- Deploy (the ONE true command — see docs/DEPLOY.md):
  `npx wrangler deploy --config wrangler.cockpit.toml --var BUILD_SHA:<sha> --var BUILD_TIME:<iso>`
  (load .env.local creds first; deploy:production/staging do NOT work for the cockpit).
- Pulse: `npm run hartos:autopilot`. Runner: `npm run hartos:runner`. Birth: `npm run factory:birth`.

## Gotchas (will bite you)

- **PowerShell here-string commit messages: NO double-quotes AND NO backticks/angle-brackets** — they
  break `git commit -m @'…'@` (message words become pathspecs). Plain ASCII prose only.
- **"Cockpit looks unchanged" = stale browser tab.** Server sends `Cache-Control: no-store`; hard-refresh
  (Ctrl+Shift+R) or incognito. The deploy is real; verify via `/health` `version`.
- **Push** needs Git Credential Manager interactive auth — works when Hart is at the home screen;
  hangs when remote. A PAT/SSH would make it headless (not yet done).
- **Sibling-session files — DO NOT TOUCH**: src/cockpit/suggestions/suggestion-to-mutation.ts,
  tests/approved-executor.test.ts (another session owns them). Commit path-scoped.
- Doctrine is sacred: propose → approve → execute → audit. The cockpit/Worker NEVER executes;
  execution is the gated PC-side runner only.
