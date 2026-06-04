# State Machine: Callback Token Workflow

A short approval token is issued, delivered via Telegram inline buttons, and consumed only after the authorized action succeeds.

---

## States

| State | Owner | Description |
|-------|-------|-------------|
| `pending` | Trigger | Action identified; token not yet issued |
| `token_created` | Trigger | Row in `action_tokens`; `consumed_at = null` |
| `buttons_sent` | Trigger | Telegram message with inline keyboard delivered |
| `awaiting_click` | Cloudflare | Waiting for user callback |
| `callback_received` | Cloudflare | `callback_query` received from Telegram |
| `token_validating` | Cloudflare | Check: not expired, not consumed, chat_id matches, user_id matches |
| `token_valid` | Cloudflare | All checks passed; Trigger task enqueued |
| `action_executing` | Trigger | Approved action running |
| `action_succeeded` | Trigger | External mutation confirmed |
| `token_consumed` | Trigger | `consumed_at` set AFTER action success |
| `audit_written` | Trigger | Audit row + debug_event written |
| `rejected` | Cloudflare | User clicked reject button |
| `expired` | Cron | Token lifetime exceeded without use |
| `error` | Trigger | Action failed; token NOT consumed |

---

## Transitions

```
pending
  → [Trigger creates token row] → token_created
  → [Telegram message with buttons sent] → buttons_sent → awaiting_click

awaiting_click
  → [callback_query arrives at Cloudflare] → callback_received
  → [user clicks reject] → rejected (no token consumed)
  → [expires_at exceeded] → expired (no token consumed)

callback_received
  → [token lookup + validation passes] → token_valid
  → [token invalid / expired / consumed] → error (silent reject + debug_event)

token_valid
  → [Trigger task enqueued] → action_executing
  → [external system confirms] → action_succeeded
  → [consumed_at = now()] → token_consumed  ← MUST happen AFTER success
  → [audit + debug_event] → audit_written

action_executing
  → [external system error] → error (NO token_consumed; allows retry)
```

---

## Callback Data Format

```
callback_data = "tok:" + tok
```

- Max: 64 bytes (Telegram hard limit)
- `tok` max 20 chars, alphanumeric + `_-`
- Example: `"tok:xK9mP2a3qR7b"` = 16 bytes ✓
- NEVER embed UUIDs, ClickUp IDs, or long strings directly

Validation on receipt:
```typescript
const MAX_BYTES = 64;
const encoded = new TextEncoder().encode(callbackData);
if (encoded.length > MAX_BYTES) throw new Error('callback_data too long');
```

---

## Final State Proof

A callback token workflow is **done** only when ALL of the following are true:

- [ ] `action_tokens.consumed_at` is NOT null
- [ ] The authorized action is confirmed in the external system
- [ ] Audit row exists in `{{AUDIT_TABLE}}`
- [ ] `debug_events` row with `outcome=ok`
- [ ] User received confirmation message

**A token must NOT be consumed if the action failed.**
If the action fails, leave `consumed_at = null` so a retry is possible.

---

## Security Rules

- Validate `chat_id` matches the token's `telegram_chat_id`
- Validate `user_id` matches the token's `telegram_user_id`
- Check `expires_at > now()`
- Check `consumed_at is null`
- All four checks must pass before enqueuing the action
- Re-validate in Trigger (race condition guard)

---

## Failure Modes

| Failure | State | Recovery |
|---------|-------|----------|
| Buttons not delivered | `token_created` | Retry delivery; do not re-create token |
| Token expired | `expired` | Re-issue token; re-send buttons |
| Action fails after token validated | `error` | Token NOT consumed; user can retry |
| Double-click race | second click hits `consumed` check | Idempotent: second click rejected |
