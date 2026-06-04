# Beezulbub Batch Digest: test-agent

Phase 11B: Digest multiple repositories in one command.

---

## Create a batch config

```json
{
  "target": "dashboard_layout",
  "repos": [
    { "name": "repo-a", "localPath": "external-repos/repo-a" },
    { "name": "repo-b", "localPath": "external-repos/repo-b" }
  ]
}
```

## Run batch digest

```bash
npm run beezulbub:batch -- --repos=my-batch.json --target=dashboard_layout
```

## What batch digest does

1. Loads batch config JSON
2. Digests each repo in sequence
3. Continues even if one repo fails
4. Scores and ranks all digested repos
5. Produces batch report with:
   - Ranked candidates
   - Recommendation for best devour target
   - Rejected candidates
6. Writes batch report to `beezulbub-reports/`

## Fixture example

```bash
npm run beezulbub:batch -- --repos=tests/fixtures/beezulbub/batch-repos.json
```

## After batch

```bash
npm run beezulbub:compare  # compare all candidates
```
