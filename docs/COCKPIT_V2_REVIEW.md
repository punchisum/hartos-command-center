# Cockpit V2 — Review & Audit (2026-06-09)

Design sprint. No code changed in this document — audit, critique, justify. Aesthetic
direction (from Hart): **clean, sleek, a little futuristic** — reference register: Linear /
Vercel / Arc / Bloomberg Terminal / Apple Fitness / Palantir.

> Screenshot note: the reference screenshot did not arrive as viewable image data, so this
> review does NOT contain a screenshot UI/UX/IA audit. It is grounded in the *actual current
> render* (`src/runtime/cloudflare-cockpit-page.ts`). When the image is re-shared, a
> per-component KEEP / MODIFY / MERGE / REMOVE audit will be appended.

---

## The core problem, stated precisely

The bottleneck is no longer intelligence — it's **visibility**, and the gap is now measurable:

| Intelligence layer | Exists? | Rendered on the cockpit page? |
|---|---|---|
| Daily brief | ✅ | ✅ (as "Needs attention") |
| Fleet signals | ✅ | ✅ (grid4 cards) |
| Proposals | ✅ | ✅ (1 box of ~14 in grid3) |
| Perception / Forecast / Synthesis | ✅ | ✅ (3 boxes in grid3) |
| **Strategic Awareness** (risks/opps/drift/blind-spots) | ✅ | ❌ **Ask-only — never on the page** |
| **Executive Memory** (patterns/lessons/trends) | ✅ | ❌ **Ask-only — never on the page** |
| Agent Depth (Coach/Operator/CTO contracts, risk+opportunity) | ✅ | ⚠️ Partially (fleet card headline only) |

**The two newest, highest-value layers are invisible on the dashboard.** They were shipped as
`strategic_brief` and `executive_memory` Ask intents — a user must *type a question* to see
them. The page itself still renders the *older* perception/forecast/synthesis layer as 14
equal-weight boxes. The cockpit is literally a generation behind the brain.

---

## Current render — what's actually there

Source: `renderHostedCockpitPage()` (`cloudflare-cockpit-page.ts:600`).

```
Sidebar (208px): ◆ HartOS · [home, agents, proposals, health, control] · READ-ONLY · H/Hart
Main:
  Header:        "Command Center" · SYSTEM STATUS pill · "as of <ts>" · action execution: disabled
  Ask bar:       input + ⌘K + voice + send · 5 chips · hidden <pre> answer
  H2 "⚠ Needs attention":  main action (bold) + ranked attention rows + "no red issues"
  H2 "Fleet":    grid4 of agent cards (icon/status/metrics/headline/confidence/freshness)
  grid3 (1fr 1fr 1fr): 14 boxes, equal weight, in this order —
     suggestions · proposals · mutationCenter · fleetBrain · fresh · trust ·
     fleetSynthesis · autonomy(cond) · mutationDispatch · audit · activity ·
     perception · orchestration · forecast · factoryJobs(cond)
  Footer:        read-only disclaimer · /health · /api/state
```

---

## Strengths (keep these)

1. **Honesty is already designed-in** — verdicts, freshness, confidence, "UNKNOWN" states,
   "no red issues" affirmations. This is rare and valuable; V2 must preserve every bit of it.
2. **Server-rendered, no-secret, read-only** — fast first paint, no client data fetching to see
   the core picture. Keep this as the V2 default; JS stays progressive enhancement.
3. **The "Needs attention" hero instinct is right** — it already tries to lead with the one
   main action. V2 formalizes this into a true Executive Brief.
4. **Tone system** (`tone()` → g/a/r/i traffic-light from verdict×confidence×freshness) is a
   solid, honest visual primitive. Reuse it.
5. **Fleet cards** already carry status/confidence/freshness/headline — close to the V2 spec;
   they need risk/opportunity added and vanity removed, not a rebuild.
6. **Conditional rendering** (factory jobs / autonomy hidden when empty) — the right reflex for
   noise control. V2 extends this discipline everywhere.

---

## Top 10 UX failures

1. **Flat 14-box grid = no hierarchy.** Everything is the same size and weight, so nothing is
   important. The eye has no entry point. This is the single biggest failure.
2. **The best intelligence is hidden.** Strategic Awareness + Executive Memory require typing a
   question. A dashboard that hides its best output is failing at its one job.
3. **Approvals are buried.** Pending approvals are one box among fourteen — the spec says they
   "should never be hidden." Right now they routinely are, below the fold.
4. **No Executive Brief as a distinct surface.** The "if Hart reads nothing else" content is
   diluted into a generic "Needs attention" list mixed with affirmations.
5. **Below-the-fold dead zone.** On a laptop, ~10 of 14 boxes are scroll-only. Perception,
   forecast, audit, activity — all the way down. They're effectively never seen.
6. **Redundant/overlapping panels.** suggestions, fleetBrain, perception, forecast, synthesis,
   orchestration all answer overlapping "what matters / what's next" questions in different
   words. Cognitive load with no payoff.
7. **Navigation doesn't match the work.** Sidebar is home/agents/proposals/health/**control** —
   "control" and "agents" are dev-oriented; there's no Awareness or Memory destination at all.
8. **Timestamp is a raw ISO string** ("as of 2026-06-09T12:00:00.000Z"). Not human, not glanceable.
9. **No motion, no depth, no focus state.** It reads as a static report, not a living system —
   the opposite of the "feels powerful" goal. (Not asking for animation spam — asking for
   tasteful entrance/hover/active states and subtle elevation.)
10. **Mobile is an afterthought.** The grid collapses to one column → a 14-box vertical scroll.
    The 30-second mobile goals (top risks, opportunities, brief, approve, status) are unmet.

## Top 10 decision-making failures

1. **No single "Recommended Focus" anchor.** The brief's main action exists but isn't visually
   the hero; it competes with 14 boxes for attention.
2. **Risk and Opportunity aren't co-located.** A risk in one box, an opportunity in another,
   memory nowhere — Hart can't weigh trade-offs at a glance.
3. **No historical context at the point of decision.** Executive Memory knows "ops stale 4× in
   60d" but the live ops risk on the page shows no such annotation, so a recurring problem looks
   like a one-off.
4. **Approvals lack decision scaffolding on the page.** The System-Quality patch added
   why-approve / why-reject reasoning to the proposal *view*, but it's in a low box; the decision
   surface isn't elevated to where decisions actually get made.
5. **No "what can wait" signal.** Everything shown implies "look at me now." There's no explicit
   defer/snooze framing, so low-priority items consume the same attention as urgent ones.
6. **Drift is invisible.** A slowly-degrading situation (data/project/confidence drift) never
   surfaces until it's an acute risk — exactly the early-warning the Awareness layer was built for.
7. **Lessons never reach the decision.** "Last 3 recovery dips followed interval-heavy weeks" is
   computable but never shown next to today's training call.
8. **Confidence/freshness shown but not weighted into ranking visibly.** Hart can't tell if the
   top item is top because it's urgent or just because it's first in the list.
9. **No cross-agent correlation surfaced as a decision.** Fleet synthesis correlates risks but
   it's a mid-grid box, not framed as "these three signals are the same underlying problem."
10. **Verdict provenance is opaque.** SYSTEM STATUS = AMBER, but *why* (which domain, which
    signal) requires hunting. A decision-maker needs the driver, not just the color.

---

## Information Architecture audit

**Current IA:** one long scroll — brief → fleet → undifferentiated panel soup. No section
priority encoded in layout; "lowest priority" (system health) sits at the same weight as the
executive brief.

**Required IA (from the mission), in priority order:**
1. Executive Brief (always visible, hero) — Top Risk · Top Opportunity · Top Approval · Recommended Focus · System Status
2. Strategic Awareness (3–5 per category) — Risks · Opportunities · Drift · Blind Spots
3. Executive Memory — Recurring Patterns · Lessons · Trend Summary · Historical Context
4. Today's Focus — single highest-leverage actions + what can wait
5. Fleet Status — per-agent Status/Confidence/Freshness/Risk/Opportunity/Next Action
6. Approvals — high visibility, impact/risk/rationale/why-approve/why-reject, one-click
7. System Health — lowest priority, all technical detail quarantined here

The gap: today the page has **no weighting** — IA priority must be expressed through *size,
position, and progressive disclosure*, not just order.

## Navigation audit

**Current:** home · agents · proposals · health · control (5 items, 2 dev-oriented, 0 for the
two newest layers).

**Proposed:** Overview · Awareness · Fleet · Approvals · Health (5 items, matches the mission;
≤2 clicks to anything critical). "Agents" folds into Fleet; "control" (mutation/dispatch) folds
into Approvals + Health; Awareness becomes a first-class destination carrying Strategic Awareness
+ Executive Memory.

## Component audit (current → V2 disposition)

| Current panel | Disposition | Why |
|---|---|---|
| Daily brief ("Needs attention") | **MODIFY → Executive Brief hero** | Promote to the 5-tile hero strip; it's the most important content |
| Fleet cards (grid4) | **KEEP + enrich** | Add Risk/Opportunity/Next-Action; strip vanity metrics |
| Proposals box | **MODIFY → Approvals section** | Elevate out of the grid into its own high-visibility surface |
| suggestions (cross-system "do next") | **MERGE → Today's Focus** | This IS today's focus; rename + promote |
| perception · forecast · synthesis · fleetBrain · orchestration | **MERGE → Strategic Awareness** | Five overlapping "what matters" panels collapse into Risks/Opps/Drift/Blind-Spots, sourced from these engines |
| Strategic Awareness (Ask-only) | **ADD to page** | The headline gap — make it a section |
| Executive Memory (Ask-only) | **ADD to page** | The headline gap — make it a section |
| fresh · trust · rms | **MERGE → System Health** | Technical; quarantine to the Health destination |
| mutationCenter · mutationDispatch | **MERGE → Approvals/Health** | Execution detail; not top-level |
| audit · activity | **MOVE → Health / a History drawer** | Useful, not decision-critical; demote |
| factoryJobs · autonomy (conditional) | **KEEP conditional, relocate** | Only when non-empty; live under Fleet/Approvals |
| Ask bar + voice + ⌘K | **KEEP, elevate** | Command palette is core to operator speed |

## Mobile audit

**Current:** grid collapses to a single column → the same 14 boxes stacked → a very long scroll;
the 30-second goals are unreachable. No bottom nav, no thumb-reachable approve, timestamps and
dense rows don't reflow well.

**Required:** a mobile-first stack — Executive Brief (5 stat tiles, 2-up) → top 3 Awareness →
Approvals (swipe/one-tap) → System Status pill → everything else behind tabs. Bottom tab bar
(Overview/Awareness/Fleet/Approvals) for thumb reach. Target: top risks + opportunities + brief +
approve + status all reachable in <30s without horizontal scroll.

---

## Screenshot audit — Flatlogic "Light Blue" admin template

Reference reviewed (downloaded + viewed): a 960×600 dark-navy analytics admin dashboard —
left nav (Dashboard/Users/E-commerce/Email/Docs + a long TEMPLATE list), top bar (promo banner,
search, admin avatar w/ badges, settings/power icons), breadcrumb "YOU ARE HERE", page title
"Analytics", a row of 4 stat cards (Visits Today / Revenue donut / App Performance bars / Server
Overview), and a large "Daily Line Chart" traffic area-chart hero. Cards have ×/collapse chrome.

**Verdict:** *adopt the skin, reject the content model.* The visual language is genuinely on-brief
(deep navy gradient, calm elevated card surfaces, restrained, premium, lightly futuristic). The
information model is the textbook analytics/KPI board the mission forbids — vanity metrics, a
traffic chart as the hero, breadcrumb chrome, dismissible cards. None of it answers "what should
Hart do next."

### Per-component KEEP / MODIFY / MERGE / REMOVE

| Component | Disposition | Why |
|---|---|---|
| Dark navy gradient background | **KEEP** (refine) | Validates dark-first; shift V2 base from near-black toward a deep navy/indigo tint — reads more premium + futuristic. See blueprint palette update. |
| Elevated card surface style | **KEEP** | Subtle panels on dark = exactly the depth language we want (hairline + faint elevation). |
| 4-stat-card top row | **MODIFY → Executive Brief hero** | Great *structural* pattern (scannable tile strip), wrong content. Repurpose into Focus/Risk/Opp/Approval/System. |
| Mini bar/line indicators inside cards | **MODIFY → Memory sparklines** | Reuse the micro-chart idea for evidence-based trend sparklines only. |
| Left sidebar (icon + label + section headers) | **MODIFY → 64px icon rail** | Keep the dark-nav idiom; collapse to the rail; cut the long TEMPLATE list. |
| Nav badges (Email "9", avatar "13") | **KEEP the pattern** | Repurpose as the live **pending-approvals count** badge — the one badge that earns its place. |
| Topbar search | **MERGE → ⌘K command** | Becomes the persistent command palette / Ask entry. |
| Admin avatar + identity | **MODIFY** | Keep minimal identity (H/Hart); drop the vanity counters. |
| Settings / globe / power icons | **MODIFY** | Keep at most a minimal set; "power"-style indicator can map to *execution status* (still disabled). |
| Promo banner ("Check out settings…") | **REMOVE** | Pure noise; antithetical to an executive surface. |
| Breadcrumb "YOU ARE HERE" | **REMOVE** | 5-destination IA + the rail make breadcrumbs redundant. |
| Page title "Analytics" | **MODIFY** | Destination titles (Overview/Awareness/Fleet/Approvals/Health). |
| Revenue donut chart | **REMOVE** | Vanity. (A fleet-health distribution dot-row, if ever, is cheaper + honest.) |
| Daily Line Chart (traffic hero) | **REMOVE as hero** | The prime real estate goes to Executive Brief + Awareness + Today's Focus, not a time-series. A small trend sparkline survives only inside Executive Memory. |
| Card ×/collapse chrome | **REMOVE** | Executive content isn't dismissible decoration; conditional rendering (empty → hidden) replaces it. |
| Orange fill + multi-color lines + multi-hue donut | **MODIFY** | Reserve color for **verdicts only** (g/a/r). One calm accent; no decorative palette. |

**Net:** the screenshot *confirms* the V2 dark-premium direction and contributes two concrete
patterns to adopt (the stat-tile strip → Executive Brief; the nav badge → approvals count) and a
clear list of anti-patterns to avoid (KPI vanity, chart-as-hero, breadcrumb/close chrome,
decorative color). It changes the blueprint's **palette** (navy-tinted, below) but not its IA or
section priorities.

---

*Continues in `COCKPIT_V2_BLUEPRINT.md` (section designs + wireframes) and
`COCKPIT_V2_IMPLEMENTATION.md` (phased, ROI-ranked roadmap).*
