# Open-Source Capability Absorption: test-agent

Beezulbub copies patterns and ideas — not architectures.

---

## The rule

> Absorb ability. Reject poison. Standardise to HartOS. Evolve pack later.

We never inherit foreign architecture. We extract capabilities and rewire them to HartOS patterns.

---

## What we absorb

- UI components (layout, tables, charts, forms)
- Logic patterns (CSV parsing, OCR extraction, file handling)
- Interaction patterns (drag-and-drop, infinite scroll, keyboard shortcuts)
- Algorithm implementations (scoring, ranking, classification)

## What we always reject

- Foreign auth models (Firebase Auth, Auth0, Clerk, etc.) → HartOS uses Telegram allowlists
- Foreign database schemas → HartOS uses Supabase as the source of truth
- Deployment configurations → HartOS uses Cloudflare Workers + wrangler
- Hardcoded secrets → Never absorbed
- Direct production deploy scripts → HartOS uses launch:staging + promote:production gates

## What we adapt

- Data fetching → Supabase REST/RPC with RLS
- Env vars → HartOS env.example pattern
- Tests → HartOS node:test pattern
- Deployment → HartOS provisioning engine

---

## Legal notes

This process creates derivative work in some jurisdictions. Always verify license compatibility before production use. MIT and Apache-2.0 are generally safe for pattern extraction. GPL/AGPL require careful review.

This is operational classification only — not legal advice.
