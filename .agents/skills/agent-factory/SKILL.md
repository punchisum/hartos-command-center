---
name: agent-factory
description: Thin conductor for building HartOS agents. Use for end-to-end agent creation flow from idea to intake, architecture, data model, jobs, interface, security, verification, and handover while coordinating specialist skills.
---

# Agent Factory

Coordinate specialist skills without becoming a mega-skill.

## Flow

1. Clarify idea and business problem.
2. Complete intake.
3. Use `system-architect` for architecture.
4. Use `supabase-rpc-builder` for durable state.
5. Use `trigger-job-builder` for execution.
6. Use `telegram-command-builder` for interface.
7. Use `security-review` before credentials, auth, database, webhooks, or business data changes ship.
8. Use `verification-loop` before calling work done.
9. Use `handover-writer` after major sessions.

## Rules

- Do not build before intake is clear.
- Define MVP scope strictly.
- Identify what should not be automated.
- Identify the source of truth.
- Identify human approval boundaries.
- Prefer small, reversible steps.
