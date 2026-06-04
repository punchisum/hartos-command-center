# Poison Filter: test-agent

Beezulbub detects and flags toxic patterns in candidate repositories.

---

## Detection categories

### File-level poison (Critical)
- `.env` file committed to repository
- `credentials.json` or service account files
- Private key files (`.pem`, `.key`, `.p12`, `id_rsa`)

### Code-level poison
- **Critical**: Hardcoded API keys, hardcoded passwords, credentials in URLs
- **High**: Hardcoded secrets/tokens, `eval()` usage, secrets logged to console
- **Medium**: `process.env` with hardcoded fallback values

### Architecture poison
- **Medium**: No test suite, direct production deploy scripts, vendor lock-in
- **High**: Architecture that bypasses HartOS approval gates

---

## A repo can still be PARTIAL_DEVOUR

Finding poison doesn't automatically mean reject. The verdict considers both:
- The severity and count of poison flags
- The value of the extractable capabilities

A repo with a committed `.env` but otherwise excellent dashboard components is `PARTIAL_DEVOUR`:
- Absorb: dashboard layout, table components
- Reject: auth config, .env handling, deploy scripts

---

## What to do with poison

For each poison flag, Beezulbub generates a specific recommendation:
- **committed_env**: Never copy. Add to .gitignore. Use .env.example.
- **hardcoded_api_key**: Reject this code path. Extract to env var before absorbing.
- **direct_production_deploy**: Replace with HartOS launch:staging + promote:production.
- **no_test_suite**: Add tests before absorbing into HartOS packs.
