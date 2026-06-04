# Launch Reports: test-agent

Launch reports are written to `launch-reports/` by `npm run launch:staging`.

---

## Report files

| File | Purpose |
|------|---------|
| `staging-launch-*.md` | Human-readable staging launch report |
| `staging-launch-*.json` | Machine-readable launch summary (safe subset, no secrets) |
| `rollback-plan-*.md` | Rollback instructions for this launch |

---

## Reading the latest report

```bash
npm run launch:report
```

This displays the latest launch report or generates a current status report if none exists.

---

## Report structure

```markdown
# Staging Launch Report: test-agent

Environment:    staging
Launch status:  ⚠️ partial
Timestamp:      2026-06-03T...

## Summary
...

## Missing gates
...

## Provider steps
✓ readiness [success]
✓ provision:plan [success]
⚒ provision:supabase:apply_migrations [manual_required]
  Next: ALLOW_SUPABASE_MIGRATION_APPLY=true npm run migrations:apply
...

## Smoke test
Result: skipped

## Next action
...
```

---

## Security

Reports NEVER contain:
- API tokens or keys
- Database passwords
- Webhook secrets
- Authorization headers
- Raw environment variable values

Only safe metadata is included: provider names, status codes, step IDs, filenames.

---

## After a failed launch

1. View the report: `npm run launch:report`
2. Generate rollback plan: `npm run provision:rollback-plan`
3. Fix the failing step
4. Re-run: `npm run launch:staging`
