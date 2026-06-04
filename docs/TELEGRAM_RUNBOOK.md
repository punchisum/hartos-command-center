# Telegram Runbook

Required env:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_URL`
- `TELEGRAM_WEBHOOK_SECRET`
- `TELEGRAM_ALLOWED_USER_IDS`
- `TELEGRAM_ALLOWED_CHAT_IDS`

Verify bot:

```bash
npm run verify:telegram
```

Register webhook only after staging env is ready:

```bash
npm run telegram:register-webhook
```

Optional test sends require `ALLOW_TELEGRAM_TEST_SEND=true` and `DEBUG_CHANNEL_ID` or `TEST_TELEGRAM_CHAT_ID`.
