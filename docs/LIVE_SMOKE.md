# Live Smoke

Local smoke does not require secrets:

```bash
npm run smoke:local
```

Live smoke checks configured providers:

```bash
npm run smoke:live
```

Live mutation smoke is disabled unless explicitly enabled:

```bash
ALLOW_LIVE_SMOKE_MUTATION=true npm run smoke:live
```

Telegram test sends are disabled unless explicitly enabled:

```bash
ALLOW_TELEGRAM_TEST_SEND=true TEST_TELEGRAM_CHAT_ID=... npm run verify:telegram
```
