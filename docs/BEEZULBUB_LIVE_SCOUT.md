# Beezulbub Live Scout: test-agent

Phase 11B: Live GitHub search for capability candidates.

---

## Enable live scout

```bash
# Set in .env.local or export before running
BEEZULBUB_ALLOW_NETWORK=true
GITHUB_TOKEN=your_github_token  # optional but increases rate limit
```

## Run live scout

```bash
npm run beezulbub:scout -- --target=dashboard_layout --live
npm run beezulbub:scout -- --target=receipt_ocr --live --limit=5
```

## What live scout does

1. Builds a GitHub search query from the capability target
2. Calls GitHub search API via injectable fetch boundary
3. Parses repo metadata: name, stars, forks, license, language, topics, recency
4. Scores candidates by relevance (0-10)
5. Returns ranked candidates with stale risk and license guess
6. Writes scout report to `beezulbub-reports/`

## Without network gate

```
Mode: fixture (fallback)
Reason: BEEZULBUB_ALLOW_NETWORK not set
```

Fixture mode uses built-in candidates from the Beezulbub registry.

## GitHub Token

GITHUB_TOKEN is:
- Optional (public API works without it, but has lower rate limits)
- Never logged or printed
- Never included in reports
- Passed only as an Authorization header (captured in closure)

## Phase 11C direction

Live scout will feed into pack skeleton generation when candidates get a DEVOUR verdict.
