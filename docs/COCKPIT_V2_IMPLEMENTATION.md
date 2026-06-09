# Cockpit V2 — Implementation Roadmap (2026-06-09)

Phased, ROI-ranked. Pairs with `COCKPIT_V2_REVIEW.md` + `COCKPIT_V2_BLUEPRINT.md`.
Principle: **smallest high-ROI redesign first.** The biggest win needs almost no new
intelligence — it's surfacing what already exists. Nothing here changes governance,
execution, or security; every phase preserves the honesty floors.

---

## Guiding sequence

1. **Surface the hidden brain first** (Awareness + Memory onto the page) — highest ROI, lowest risk.
2. **Impose hierarchy** (Executive Brief hero + collapse the 14-box soup).
3. **Elevate Approvals + Today's Focus** (decision quality).
4. **Re-skin** to the V2 design language (clean/sleek/futuristic).
5. **Navigation + Mobile + Scaling polish.**

Each phase ships independently, verified (typecheck + tests + smoke), behind the existing
read-only contract. Order is by impact-per-effort, not by section number.

---

## PHASE 0 — Quick Wins (1 patch, ~½ day, very high ROI)

> Goal: make the page show what HartOS already knows. No new engines, pure wiring + view code.

| # | Change | Effort | Impact | Risk |
|---|--------|--------|--------|------|
| 0.1 | Add a `strategicBriefView(state, now)` that runs the existing `strategicAwareness()` (feeding perception/forecast/synthesis it already computes in render) and render a **Strategic Awareness** region (Risks/Opps/Drift/Blind-Spots, capped) | S | **Huge** — closes the #1 visibility gap | Low |
| 0.2 | Add an **Executive Brief hero strip** (5 tiles) above "Needs attention", pulling `recommendedFocus` + top risk + top opportunity + top pending approval + system-status-with-driver | S | **Huge** — gives the page an entry point | Low |
| 0.3 | Elevate the existing proposals box into an **Approvals** region directly under the hero (reuse the System-Quality `whyApprove`/`whyReject` view fields already built) | S | High — approvals stop being buried | Low |
| 0.4 | Humanize the timestamp ("12 min ago" + ISO on hover) | XS | Medium | None |
| 0.5 | Add a pending-approval **count badge** to the proposals nav item | XS | Medium | None |

Phase 0 alone resolves UX failures #2, #3, #4, #8 and decision failures #1, #2, #4. It's the
single most valuable patch and should ship first, standalone.

---

## PHASE 1 — Hierarchy & De-noise (1 patch, ~1 day, high ROI)

> Goal: kill the 14-box soup; encode IA priority in layout.

- 1.1 **Collapse overlapping panels** into Strategic Awareness: perception, forecast, synthesis,
  fleetBrain, orchestration stop rendering as 5 separate boxes — they become the *sources* of the
  Risks/Drift/Blind-Spots columns (engines unchanged; only the render consolidates).
- 1.2 **Today's Focus** region: rename `suggestions` → Today's Focus, split **Do Now / Can Wait**
  by priority (decision failure #5).
- 1.3 **Quarantine technical panels** (fresh/trust/rms/audit/activity/mutationDispatch) — stop
  rendering them on Overview; they move to the Health destination (Phase 3 builds the route, until
  then a collapsed `<details>` "System Health" at the bottom).
- 1.4 Apply **top-N + "see all"** expanders so no region can exceed its cap.

Resolves UX failures #1, #5, #6 and decision failures #6, #9.

---

## PHASE 2 — Executive Memory on the page + decision context (1 patch, ~1 day, high ROI)

> Goal: history reaches the decision.

- 2.1 Render the **Executive Memory** region (Recurring Patterns + Trend sparklines + Lessons),
  via the `ctx.memorySnapshots` seam. Until a persister exists it shows the honest
  INSUFFICIENT_HISTORY line — but the surface is built and ready.
- 2.2 **Historical-context annotation** on live risks (the brief's Top Risk + Awareness risks show
  "4× in 60d" when the memory layer corroborates) — decision failure #3.
- 2.3 Stand up the **minimal snapshot persister seam**: a Node-side helper that calls
  `snapshotFromBrief()` on a cadence and stores to the existing local/Supabase proposal-style
  store, then feeds `ctx.memorySnapshots`. (Engine already exists; this is the wiring that turns
  memory from "ready" to "live." Scoped, optional, behind a flag — not required for the UI to ship.)

Resolves decision failures #3, #7.

---

## PHASE 3 — Navigation + the V2 shell (1 patch, ~1–2 days, medium-high ROI)

> Goal: the 5-destination IA + the icon-rail shell.

- 3.1 Replace the 208px sidebar with the **64px icon rail**: Overview · Awareness · Fleet ·
  Approvals · Health (fold "agents"→Fleet, "control"→Approvals/Health).
- 3.2 Build the **routes/destinations** (server-rendered pages or hash-routed sections): Awareness
  (full Strategic Awareness + Executive Memory), Fleet (enriched cards), Approvals (full decision
  cards), Health (all quarantined technical panels).
- 3.3 **Topbar**: persistent ⌘K command (absorb the ask bar), status pill with driver tooltip.
- ≤2 clicks to anything critical. Resolves UX failure #7, nav-audit gaps.

---

## PHASE 4 — Visual excellence re-skin (1 patch, ~1–2 days, medium ROI)

> Goal: clean / sleek / futuristic. Pure CSS + markup polish; zero logic change.

- 4.1 New token set (the dark palette + single accent + mono data face from the blueprint).
- 4.2 Hairline borders, subtle elevation, accent focus rings, severity left-bars, red-dot pulse.
- 4.3 Tasteful motion (staggered entrance, hover lift, press-scale) with `prefers-reduced-motion`.
- 4.4 Mono treatment for all data/evidence/timestamps (the terminal accent).
- Resolves UX failure #9 and the "feels powerful" emotional goal.

---

## PHASE 5 — Mobile-first + scaling hardening (1 patch, ~1 day, medium ROI)

- 5.1 Mobile stack per the wireframe: hero focus → 2-up risk/opp tiles → one-tap approval →
  awareness top-3 → fleet dots; **bottom tab bar** (Overview/Awareness/Fleet/Approvals) for thumb reach.
- 5.2 Approvals tab: full-height swipeable decision cards, bottom-anchored Approve/Reject.
- 5.3 **Fleet collapse-when-healthy** + auto-fill grid (3→50 agents); top-N+expand everywhere.
- Resolves UX failure #10, the 30-second mobile goals, and the scaling requirements.

---

## ROI ranking (do in this order)

| Rank | Phase | Why first |
|------|-------|-----------|
| 1 | **Phase 0** | Surfaces the two hidden layers + gives the page hierarchy entry point. ~½ day, transformative. |
| 2 | **Phase 1** | Kills the soup; the page becomes legible. Builds on 0. |
| 3 | **Phase 2** | History-at-the-decision is the unique HartOS edge; cheap once 0/1 land. |
| 4 | **Phase 3** | Nav/shell unlocks scale + the destinations; bigger lift. |
| 5 | **Phase 4** | The "damn, powerful" polish — best done once structure is final. |
| 6 | **Phase 5** | Mobile + scale hardening — important, but desktop decision quality is the daily driver. |

**Recommended smallest high-ROI redesign to do first: Phase 0** — one focused patch that puts
Strategic Awareness + an Executive Brief hero + an elevated Approvals region onto the Overview,
reusing engines that already exist. It closes the headline "knows more than it can show" gap with
minimal surface area and zero governance risk, and it's independently shippable + testable.

---

## Verification contract (every phase)

- `npm run build` clean · full `npm test` green (add render/snapshot + view tests per phase) ·
  `npm run smoke:hosted` green · secret scan clean.
- Honesty floors preserved (UNKNOWN / INSUFFICIENT_EVIDENCE / INSUFFICIENT_HISTORY render as
  honest lines). Read-only + governance unchanged. Mobile + a11y (`prefers-reduced-motion`, focus
  rings, contrast) checked in Phases 4–5.

---

## What this roadmap will NOT do
- No new agents, no execution/governance changes, no Obsidian/RAG/persistence beyond the optional
  Phase-2 snapshot seam (flagged, off by default).
- No Dribbble-driven decoration — every visual choice serves awareness, decision quality, or density.
- No big-bang rewrite — six independently-shippable, verifiable patches; the page keeps working at
  every step.

---

*Pending the reference screenshot: when re-shared, a per-component KEEP/MODIFY/MERGE/REMOVE audit
will be appended to `COCKPIT_V2_REVIEW.md` and any adopted patterns folded into the blueprint
before Phase 0 implementation begins.*
