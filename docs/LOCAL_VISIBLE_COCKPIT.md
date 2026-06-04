# Local Visible Cockpit (Phase 11H)

> **Orchestrator = brain. Command Center contract = nervous system. Cockpit = visible control surface.**
> Phase 11H is the first *visible* cockpit phase. It runs **locally** only.
> No hosting, no auth, no Supabase, no Telegram, no Obsidian, no deploys.

## What it is

A dependency-free local browser cockpit that lets Hart *see* and *command* the
HartOS system. It renders the 22 Command Center cards (Phase 11G contract +
read model), shows system visibility (missing sources, blocked/approval/forbidden
actions, next recommended command), lists local reports, and provides an
**Ask HartOS** message box that routes into the existing local Orchestrator.

It is an **operator console**, not a chatbot: cards, statuses, traces, reports,
approvals, blocked actions, and an Orchestrator request/response panel.

## Commands

```bash
npm run cockpit:web                 # start local server (http://localhost:3000)
npm run cockpit:web -- --port=3100  # choose a port
npm run cockpit:web -- --once       # bind, print URL, close (smoke-safe)
npm run cockpit:web -- --dry-run    # build state + HTML without binding a port
npm run cockpit:snapshot            # write static cockpit reports (no server)
npm run cockpit:ask -- --request="Build me a tax specialist agent"
```

All commands use the compiled `dist/scripts/*.js` pattern with `pre<script>`
build hooks (matching Phase 11F/11G).

## What the cockpit shows

- Header: HartOS Command Center, local mode, generated timestamp, summary.
- **Ask HartOS** panel: textarea + send button, latest classification/strategy/
  CTO/build-plan summary, next recommended command.
- Card groups: Orchestrator, Factory, Beezulbub, Agents, Human Control.
- 22 cards with status / confidence / source / action states.
- Action visibility: read-only, local report generation, approval-required,
  manual-required, forbidden.
- Report list: `command-center-reports/`, `hartos-reports/`, `beezulbub-reports/`,
  `launch-reports/`, `production-reports/`, `bootstrap-reports/`, `cockpit-reports/`.

## Reports

Written under `cockpit-reports/`: `cockpit-snapshot-*.md` / `.json` / `.html`
and `cockpit-thread-*.md` / `.json`. Thread state is persisted under
`cockpit-threads/`. Reports contain no secrets.

## Boundaries

Every action button renders **disabled** — the cockpit never executes. Dangerous
actions render as blocked/forbidden. See
[COCKPIT_SECURITY_BOUNDARIES.md](COCKPIT_SECURITY_BOUNDARIES.md).
