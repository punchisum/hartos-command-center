# Adaptive Pack Skeletons: test-agent

Phase 11C generates HartOS-shaped pack skeletons — not third-party code transplants.

---

## Doctrine

```
Absorb ability.
Reject poison.
Generate skeleton.
Do not copy architecture.
Do not copy code blindly.
```

---

## What a pack skeleton is

A pack skeleton is a structured set of stubs, docs, and contracts that define:
1. **What** will be implemented (adaptation-plan.md)
2. **What** was excluded (rejected-poison.md)
3. **Where** the implementation goes (directory structure)
4. **What** tests are required (pack.contract.test.ts)
5. **What** smoke tests prove (smoke-plan.md)

It is NOT:
- Third-party code copied verbatim
- A working implementation
- Production-ready without review

---

## HartOS shaping

Every generated pack assumes:

- **Data layer:** Supabase with RLS
- **Runtime:** Cloudflare Worker + Trigger.dev
- **Auth:** HartOS gates (no foreign auth)
- **Secrets:** env vars only, never hardcoded
- **Deployment:** HartOS launch:staging → promote:production

---

## Implementation order

After pack generation, implement in this order:

1. Define Supabase schema (`migrations/`)
2. Implement business logic (`runtime/`)
3. Implement components (`components/`)
4. Write tests (`tests/`)
5. Write smoke plan (`smoke/`)
6. Security review
7. HartOS gate wiring

---

## Safety guarantees

Generated packs pass safety scan before writing:
- No raw secrets
- No copied `.env`
- No third-party auth as implementation
- No deployment that bypasses HartOS gates
