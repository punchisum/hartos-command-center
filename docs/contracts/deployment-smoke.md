# Deployment / Smoke Test Plan Template

**Agent:** {{AGENT_NAME}}
**Version:** {{VERSION}}
**Deploy date:** {{DATE}}

> **Key principle:** A smoke test is not done when the task completes or the Trigger job succeeds.
> It is done only when the **final state is proven** — DB rows, tokens, external mutations, audit trails.

---

## Pre-Deployment Checklist

- [ ] Supabase migration applied to staging
- [ ] All CHECK constraint values match TypeScript unions
- [ ] Schema smoke test (insert all valid statuses) passed
- [ ] Cloudflare Worker deployed to staging
- [ ] Trigger.dev job registered and active
- [ ] All secrets set in platform dashboards (not in code)
- [ ] `.env.example` up to date with new variables
- [ ] No real secrets in committed files

---

## Smoke Tests

### Test 1: {{COMMAND_OR_WORKFLOW_NAME}}

**Trigger:** {{HOW_TO_TRIGGER — e.g., send /command in Telegram}}

**Final state to prove (check ALL of these):**

- [ ] **DB row created:** `{{TABLE}}` row with `id={{EXPECTED_ID}}` and `status={{EXPECTED_STATUS}}`
- [ ] **Status correct:** Not still `pending` or `processing`
- [ ] **Preview delivered:** User received expected message in chat
- [ ] **Buttons delivered:** Inline keyboard buttons rendered (if applicable)
- [ ] **Token issued:** Row in `action_tokens` with `tok={{SHORT_TOK}}` and `consumed_at=null`
- [ ] **Approval flow:** User clicks button → action executes → `consumed_at` set
- [ ] **External mutation:** {{EXTERNAL_SYSTEM}} updated as expected (verify in dashboard)
- [ ] **Token consumed:** `action_tokens.consumed_at` is now set
- [ ] **Debug event:** Row in `debug_events` with `outcome=ok` and correct `trace_id`
- [ ] **Audit row:** Row in `{{AUDIT_TABLE}}` confirming the action

**SQL to verify:**
```sql
-- Check the main row
select id, status, created_at from public.{{TABLE}}
where created_at > now() - interval '5 minutes'
order by created_at desc limit 5;

-- Check the token was consumed
select tok, action_code, consumed_at, expires_at
from public.action_tokens
where created_at > now() - interval '5 minutes';

-- Check debug event
select trace_id, runtime, stage, outcome, failure_code
from public.debug_events
where created_at > now() - interval '5 minutes'
order by created_at desc limit 10;
```

---

### Test 2: Degraded file extraction (if file handling enabled)

**Trigger:** Send a scanned PDF (image-only, no text layer)

**Final state to prove:**

- [ ] `extraction_status = 'degraded'` in DB
- [ ] `ocr_attempted = true` in DB
- [ ] `degraded_reason` is set and human-readable
- [ ] `analysis_eligible = false` in DB
- [ ] **No LLM analysis row created** (analysis must be blocked when degraded)
- [ ] User received an honest degraded message (not a fake success)
- [ ] Debug event with `outcome=degraded` and `failure_code` set

---

### Test 3: Duplicate / idempotency guard

**Trigger:** Send the same command/trigger twice in rapid succession

**Final state to prove:**

- [ ] Only **one** row created in `{{TABLE}}` (not two)
- [ ] Second attempt detected as duplicate and skipped
- [ ] No duplicate `idempotency_key` errors in logs
- [ ] No `21000 cardinality_violation` Postgres error

---

### Test 4: Auth rejection

**Trigger:** Send a request from an unauthorized user/chat

**Final state to prove:**

- [ ] Request rejected with 401/403 at Cloudflare gateway
- [ ] No Trigger job enqueued
- [ ] No DB rows created
- [ ] Debug event with `outcome=error` and `failure_code=UNAUTHORIZED`

---

## Post-Smoke Verification

- [ ] All tests above passed
- [ ] No unexpected errors in Cloudflare Worker logs
- [ ] No failed Trigger.dev job runs
- [ ] No Postgres errors in Supabase logs (check for 23514, 23505, 22P02, 21000)
- [ ] debug_events table has `outcome=ok` for all successful runs

---

## Production Deployment Gate

**Do NOT deploy to production until all smoke tests pass on staging.**

After production deploy, re-run Test 1 on production to confirm the deploy is live-green.

---

## Rollback Instructions

If smoke tests fail after deploy:

1. **Cloudflare:** `wrangler rollback` or redeploy previous version from dashboard
2. **Trigger.dev:** Disable the failing job, re-enable the previous version
3. **Supabase:** If migration was applied, run the reverting migration
4. **Data repair:** See `agent.yaml → rollback.data_repair_path`
