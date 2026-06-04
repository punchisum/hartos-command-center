# Beezulbub Packs: test-agent

Phase 11C: Generate HartOS-compatible pack skeletons from approved digests.

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm run beezulbub:pack-plan` | Plan which pack to generate (no files created) |
| `npm run beezulbub:pack-generate -- --capability=<name> --from-latest --approve-devour` | Generate pack skeleton |
| `npm run beezulbub:pack-list` | List all generated packs |

---

## Quick flow

```bash
# 1. Digest a repo
npm run beezulbub:digest -- --repo=tests/fixtures/beezulbub/clean-dashboard

# 2. Plan the pack (no files created)
npm run beezulbub:pack-plan

# 3. Generate the pack skeleton (requires approval)
BEEZULBUB_ALLOW_PACK_GENERATE=true npm run beezulbub:pack-generate -- \
  --capability=dashboard_layout --from-latest --approve-devour

# 4. List packs
npm run beezulbub:pack-list
```

---

## Pack structure

```
packs/<capability>/
├── pack.manifest.json        — machine-readable manifest
├── README.md                 — human overview
├── adaptation-plan.md        — what to absorb/reject and how
├── source-digest-summary.md  — safe summary of source analysis
├── rejected-poison.md        — what was excluded and why
├── implementation-notes.md   — notes for implementers
├── components/README.md      — UI component stubs
├── migrations/README.md      — Supabase migration stubs
├── runtime/README.md         — Worker/Trigger stubs
├── tests/pack.contract.test.ts — contract tests
├── smoke/smoke-plan.md       — smoke test plan
└── TODO.generated.md         — implementation task list
```

---

## Approval required

Pack generation requires BOTH:
- CLI flag: `--approve-devour`
- Env var: `BEEZULBUB_ALLOW_PACK_GENERATE=true`

Without approval, returns `blocked_missing_approval`.

---

## Verdict rules

| Verdict | Pack generation |
|---------|----------------|
| `DEVOUR` | ✅ Allowed |
| `PARTIAL_DEVOUR` | ✅ Allowed |
| `REFERENCE_ONLY` | ⚠ Only with `--reference-pack` |
| `REJECT_*` | ❌ Blocked |

---

## What packs contain

**Only:** stubs, docs, manifests, placeholder tests, adaptation plans.

**Never:** third-party source code, copied `.env`, package-lock from external repos, foreign auth models as implementation.
