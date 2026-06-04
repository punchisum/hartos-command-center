# Beezulbub GitHub Search: test-agent

Technical documentation for the GitHub search integration in Phase 11B.

---

## Search query construction

Each capability target maps to a GitHub search query:

| Target | Search query |
|--------|-------------|
| `dashboard_layout` | `dashboard react tailwind language:TypeScript stars:>50` |
| `receipt_ocr` | `receipt ocr typescript language:TypeScript stars:>50` |
| `pdf_parser` | `pdf parse typescript node language:TypeScript stars:>50` |
| Unknown targets | `{target words} language:TypeScript stars:>50` |

## Scoring

Candidates are scored 0-10 based on:
- Target word match in name/description/topics
- Star count (>1000: +2, >100: +1)
- Recency (pushed <3 months: +1, >24 months: -1)
- Description match

## Rate limits

| Auth | Rate limit |
|------|------------|
| No token | 10 requests/minute |
| With GITHUB_TOKEN | 30 requests/minute |

## Security

- GITHUB_TOKEN is captured in closure — never returned, logged, or included in output
- Authorization header is never logged
- Only public metadata is included in results
- No code is accessed — only repository metadata

## Injectable fetch boundary

The GitHub search uses injectable fetch:

```typescript
const result = await searchGitHub({
  target: "dashboard_layout",
  allowNetwork: true,
  fetchImpl: myMockFetch, // for testing
});
```

Tests always use mocked fetch — no real network calls.
