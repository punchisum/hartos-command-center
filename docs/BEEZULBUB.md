# Beezulbub: Open-Source Capability Absorption Engine

**Doctrine: Absorb ability. Reject poison. Standardise to HartOS. Evolve pack later.**

Beezulbub is the HartOS engine for inspecting external repositories and extracting capabilities worth absorbing into the HartOS ecosystem.

---

## Phase 11A: Analysis and planning only

No pack generation. No third-party code copied automatically. Analysis and planning only.

---

## Commands

| Command | Purpose |
|---------|---------|
| `npm run beezulbub:scout` | Find candidate repos for a capability target |
| `npm run beezulbub:digest` | Analyse a local repository |
| `npm run beezulbub:score` | Show the latest score |
| `npm run beezulbub:report` | Show the latest report |

---

## Quick start

```bash
# Scout candidates for a capability
npm run beezulbub:scout -- --target=dashboard_layout

# Digest a local repo (clone first if needed)
git clone https://github.com/user/repo /tmp/my-repo
npm run beezulbub:digest -- --repo=/tmp/my-repo --target=dashboard_layout

# View score and report
npm run beezulbub:score
npm run beezulbub:report
```

---

## Verdicts

| Verdict | Meaning |
|---------|---------|
| `DEVOUR` | High value, clean, safe to absorb |
| `PARTIAL_DEVOUR` | Worth absorbing, but some parts must be rejected |
| `REFERENCE_ONLY` | Study patterns but do not copy code |
| `REJECT_POISON` | Safety/security issues outweigh value |
| `REJECT_LICENSE` | License incompatible or too risky |
| `REJECT_STALE` | Unmaintained/abandoned |
| `REJECT_LOW_VALUE` | Not worth the extraction effort |

---

## What gets analysed

1. **License** — MIT/Apache safe, GPL/AGPL risky
2. **Stack** — TypeScript, React, Supabase, Cloudflare compatibility
3. **Test presence** — none/minimal/present
4. **Env handling** — safe/basic/unsafe
5. **Poison flags** — committed .env, hardcoded secrets, direct prod deploy
6. **Capabilities** — extractable UI/logic components
7. **HartOS compatibility** — can this be adapted without a full rewrite?

---

## Phase 11B direction

- Live GitHub search integration
- Batch digestion of multiple candidates
- Pack skeleton generation from approved digests
