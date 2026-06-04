# Observability Checks: test-agent

Phase 9 adds read-only observability checks against Supabase debug_events.

---

## Run observability check

```bash
npm run observability:check
```

This checks `debug_events` in your Supabase project for recent activity and error rates.

---

## What it checks

- Recent debug_events count (last 24h)
- Error rate (percentage of outcome=error events)
- Table availability (migrated or not)

---

## Status values

| Status | Meaning |
|--------|---------|
| `ok` | debug_events readable, error rate < 20% |
| `degraded` | debug_events readable but error rate > 20% or no events |
| `missing_env` | SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set |
| `error` | Table not found or connection failed |

---

## Never prints secrets

The SUPABASE_SERVICE_ROLE_KEY is never logged or included in output. Only status codes and counts are shown.

---

## Post-launch observability

After a production launch, run observability:check to confirm:
- Agent is running and emitting events
- Error rate is acceptable
- All workflows are completing successfully
