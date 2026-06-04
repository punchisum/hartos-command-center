# Release Comparison: test-agent

Compare consecutive launch reports to detect changes between releases.

---

## Run release comparison

```bash
npm run release:compare
```

This compares the two most recent staging launch reports.

---

## What it compares

- Launch status changes (e.g. `partial` → `success`)
- Smoke result changes
- New manual_required steps
- Resolved manual_required steps

---

## When to use

Run `release:compare` after each staging launch to understand what changed since the last release. This is especially useful before promoting to production.

---

## Reports

Release comparison reports are written to `launch-reports/release-compare-*.md`.
