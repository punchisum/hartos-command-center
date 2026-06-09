# Cockpit V2 — Blueprint (2026-06-09)

Design specification + wireframes. Pairs with `COCKPIT_V2_REVIEW.md` (audit) and
`COCKPIT_V2_IMPLEMENTATION.md` (roadmap). Aesthetic: **clean, sleek, a little futuristic** —
Linear's calm + Bloomberg's density + Palantir's gravity + Apple Fitness's clarity.

---

## 1. Design language

**Mood:** quiet power. Dark, deep, high-contrast where it matters, restrained everywhere else.
Information-dense without feeling busy. The futurism comes from *precision and depth* (hairline
borders, subtle glow on live signals, monospace accents on data) — never from neon or chrome.

### Color (dark-mode first — navy-tinted, validated by the reference screenshot)
The Flatlogic "Light Blue" reference confirmed a **deep navy/indigo** base reads more premium and
slightly futuristic than a flat near-black. V2 adopts a navy-tinted dark with a very subtle
top-to-bottom gradient on the app shell (not on cards).
```
--bg            #0B0E16   deep navy-black base (faint indigo tint)
--bg-grad-top   #0E1220   shell gradient top (subtle, ~6% lighter) — the screenshot's depth cue
--bg-elev       #141927   elevated surface (cards) — navy, not grey
--bg-elev-2     #1A2030   hover / nested
--line          #232A3B   hairline borders (1px, low contrast — structure without noise)
--line-strong   #2C3550   section dividers
--txt           #E8EBF2   primary text
--txt-dim       #9AA3B8   secondary
--txt-faint     #5B6479   tertiary / captions
--accent        #5B8DEF   single brand accent (calm blue) — focus/active/primary only
--accent-glow   rgba(91,141,239,.18)  soft focus halo
--green         #3FB950   healthy / clear
--amber         #D29922   watch
--red           #F85149   attention / urgent
--idle          #6E7681   unknown / idle
```
Traffic-light hues stay reserved for *verdicts only* — never decoration (the reference's
decorative orange/multi-hue is explicitly rejected). One accent color, used for focus rings, the
active nav item, and primary actions. No rainbow. The futurism is the navy depth + hairlines +
mono data, not color.

### Type
- UI: Inter / system sans. Tight, confident hierarchy.
- Data & evidence: a mono (e.g. `ui-monospace`, "Geist Mono") for numbers, timestamps, IDs,
  "4× in 60d" — the Bloomberg/terminal accent that signals "this is real data."
- Scale: 28/600 hero verdict · 18/600 section titles · 14/500 body · 12/500 caption ·
  11 mono labels. Generous line-height (1.5 body).

### Depth & motion
- Elevation by **1px hairline + a barely-there shadow**, not heavy drop shadows.
- Live/critical signals get a **2px left accent bar** + optional 1.5s slow pulse on red dots only.
- Entrance: 120ms fade+rise on first paint (staggered by section). Hover: 80ms bg lift. Focus:
  accent ring. Active approve/reject: 100ms scale-press. Respect `prefers-reduced-motion`.
- Spacing rhythm: 8px base; 16/24/32 between groups; cards breathe (16–20px padding).

### Density
High but structured: tight rows inside a card, generous gaps between cards. The Bloomberg lesson
— dense is fine when hierarchy is ruthless.

---

## 2. Layout shell

```
┌────────────┬──────────────────────────────────────────────────────────────┐
│  RAIL 64px │  TOPBAR  (command ⌘K · system status pill · "12 min ago")      │
│  (icons)   ├──────────────────────────────────────────────────────────────┤
│  ◆         │                                                                │
│  ▣ Overview│            ROUTED CONTENT (Overview / Awareness /              │
│  ◬ Aware   │             Fleet / Approvals / Health)                        │
│  ⬡ Fleet   │                                                                │
│  ✓ Approve │                                                                │
│  ♥ Health  │                                                                │
│            │                                                                │
│  H (you)   │                                                                │
└────────────┴──────────────────────────────────────────────────────────────┘
```
- **Icon rail (64px)**, not a 208px sidebar — reclaims horizontal space for density; labels on
  hover/expand. 5 destinations: Overview · Awareness · Fleet · Approvals · Health.
- **Topbar**: persistent ⌘K command input (collapses the old ask bar into a global affordance),
  the System Status pill (with driver tooltip), and a *humanized* relative timestamp.
- Content max-width ~1200px, centered, so density never becomes a fire-hose on wide monitors.

---

## 3. Section designs

### SECTION 1 — Executive Brief (hero, always visible, top of Overview)
The "if Hart reads nothing else" strip. Five tiles in one row (2×3 on tablet, stacked on mobile):

```
┌─ RECOMMENDED FOCUS ─────────────────────────┐  ┌ SYSTEM ─┐
│ ▸ Triage 3 blocked ops cards first          │  │  AMBER  │
│   highest leverage today · ops              │  │ ● ops   │
└─────────────────────────────────────────────┘  └─────────┘
┌ TOP RISK ──────────┐ ┌ TOP OPPORTUNITY ───┐ ┌ TOP APPROVAL ──────┐
│ ● Ops data stale   │ │ ◇ 2 parked approvals│ │ Refresh ClickUp     │
│ 4× in 60d (mono)   │ │ minutes → unblock   │ │ low risk · 1 tap →   │
│ → re-run import    │ │ → clear now         │ │ Approve  Reject      │
└────────────────────┘ └─────────────────────┘ └─────────────────────┘
```
- **Recommended Focus** is the largest tile — the single anchor. Pulled from
  `StrategicBrief.recommendedFocus`.
- **Top Risk** carries its **historical context** inline (Executive Memory annotation) — the
  decision-quality fix #3. If insufficient history, the line is simply omitted (honest).
- **Top Approval** is actionable *in the brief* — Approve/Reject without leaving Overview.
- **System** tile shows the verdict **and its driver** (the failing domain), fixing opacity #10.
- Honesty floor: if `status === insufficient_evidence`, the strip shows "Awareness pending — no
  domain has resolved live data" instead of empty tiles. Never fabricate a focus.

### SECTION 2 — Strategic Awareness (Overview + the Awareness destination)
Four columns, **max 3–5 items each**, sourced from `strategicAwareness()`:
```
RISKS (≤4)        OPPORTUNITIES (≤3)   DRIFT (≤3)           BLIND SPOTS (≤4)
● ops stale  4×   ◇ cheap ops unblock  ↘ data drift: ops    ? flying blind on X?
● low recovery    ◇ recovery capacity  ↘ project drift      ? unwired source Y
● stale data                            ↘ confidence drift
```
- Each risk row: dot (severity) · subject · **mono history badge** if recurring · confidence
  chip · hover reveals why+evidence+suggested action.
- Empty categories render a single calm line ("No drift crossed the threshold") — not a blank.
- On Overview, this is collapsed to the top item per column; the Awareness destination shows all.

### SECTION 3 — Executive Memory (Awareness destination; teaser on Overview)
```
RECURRING PATTERNS                     TREND SUMMARY
● ops stale ............ 4× / 60d      risk_count   ▁▂▃▅  rising
● recovery dip ......... 3× / 60d      confidence   ▅▄▃▃  falling
                                       freshness    ▅▅▅▅  stable
LESSONS LEARNED
"Recovery dips 3× after interval-heavy weeks — treat interval blocks as a standing recovery risk."
```
- Patterns as a clean ranked list with **mono frequency badges** (the terminal accent).
- Trends as tiny sparkline + direction word (evidence-based; "—" + "insufficient history" when <3 points).
- Lessons as quoted, italic, evidence-linked one-liners. Never raw logs.
- Honesty: `INSUFFICIENT_HISTORY` renders one explanatory line, no fake patterns.

### SECTION 4 — Today's Focus (Overview)
The cross-system ranked "do next" (from `cockpitSuggestions`), reframed:
```
DO NOW                          CAN WAIT
1 ▸ Triage 3 blocked ops cards   · Review 4 stale cards (low)
2 ▸ Get protein in before train  · Expire 2 duplicate proposals
```
- Two columns: **Do Now** (high/medium priority) vs **Can Wait** (low) — fixes decision-failure
  #5 ("what can wait"). Each row one-click to the relevant destination.

### SECTION 5 — Fleet Status (Fleet destination; compact strip on Overview)
Per-agent card, vanity stripped, decision-oriented (Agent Depth contract):
```
┌ OPS · Operator ───────────────●AMBER┐   Status   ● amber
│ "Triage 3 blocked first"             │   Conf     ▰▰▰ high
│ Risk  stall (3 blk + 4 stale)        │   Fresh    live · 12m
│ Opp   2 parked approvals             │   Risk     stall risk
│ Next  Triage blocked cards →         │   Opp      quick unblock
└──────────────────────────────────────┘   Next     triage →
```
- Six fields exactly: Status · Confidence · Freshness · Risk · Opportunity · Next Action.
- Scales 3→50 agents: grid auto-fills; agents sort by severity; healthy agents collapse to a
  one-line "● green · nominal" row so attention concentrates on the few that need it.

### SECTION 6 — Approvals (Approvals destination; surfaced in brief + a persistent count badge)
Never hidden. Each approval is a decision card:
```
┌ Refresh ClickUp import ───────────── low risk · pending ┐
│ Impact   ops view goes current; downstream decisions fix │
│ Risk     none — read-only refresh                        │
│ Why ✓    clears the stale-data risk above (recurring 4×) │
│ Why ✗    you'd rather refresh manually                   │
│                              [ Approve ]   [ Reject ]     │
└──────────────────────────────────────────────────────────┘
```
- Pulls the System-Quality patch's `whyApprove`/`whyReject`/`effect` + hygiene flags
  (duplicate/stale badges). One-click Approve/Reject (gated, audited — unchanged governance).
- The nav rail shows a live pending-count badge so approvals are never out of sight.

### SECTION 7 — System Health (Health destination only; lowest priority)
All technical detail quarantined: read-model health, sync/freshness diagnostics, hosted status,
execution status (still "disabled"), audit tail, recent activity, mutation dispatch readiness.
Plain, dense, monospace-friendly. Never competes with decision content.

---

## 4. Desktop wireframe — Overview (the one screen that matters)

```
┌─────┬───────────────────────────────────────────────────────────────────────┐
│ ◆   │  ⌘ Ask HartOS…                         ● AMBER  (ops)    ⟳ 12 min ago    │
│     ├───────────────────────────────────────────────────────────────────────┤
│ ▣ ● │  EXECUTIVE BRIEF                                                         │
│ ◬   │  ┌ RECOMMENDED FOCUS ───────────────────────────┐ ┌ SYSTEM ─────────┐   │
│ ⬡   │  │ ▸ Triage 3 blocked ops cards first           │ │   AMBER         │   │
│ ✓ ②│  │   highest leverage today · ops               │ │   ● ops stale    │   │
│ ♥   │  └──────────────────────────────────────────────┘ └─────────────────┘   │
│     │  ┌ TOP RISK ──────────┐┌ TOP OPPORTUNITY ──┐┌ TOP APPROVAL ──────────┐   │
│     │  │ ● Ops data stale   ││ ◇ 2 parked appr.  ││ Refresh ClickUp  low    │   │
│     │  │ ⟲ 4× in 60d        ││ minutes→unblock   ││ [Approve] [Reject]      │   │
│     │  └────────────────────┘└───────────────────┘└─────────────────────────┘   │
│     │                                                                           │
│     │  STRATEGIC AWARENESS                              EXECUTIVE MEMORY        │
│     │  Risks ● ops stale 4×   Opps ◇ unblock            ● ops stale … 4×/60d    │
│     │  Drift ↘ data, project  Blind ? source X          ● recovery dip 3×/60d   │
│     │                                                   ~ risk_count ▁▂▃▅ rising│
│     │                                                                           │
│     │  TODAY'S FOCUS                                    FLEET (4)               │
│     │  Do now  1▸ triage blocked  2▸ protein            ●ops amber ●fit green   │
│     │  Can wait · review stale · expire dups            ●fac idle  ●cmd green   │
│     │                                                                           │
│     │  APPROVALS (2 pending)                                          see all → │
│     │  ┌ Refresh ClickUp · low · ✓why: clears 4× stale risk  [Approve][Reject]┐│
│     │  └────────────────────────────────────────────────────────────────────┘│
└─────┴───────────────────────────────────────────────────────────────────────┘
       (System Health lives one click away — never on Overview)
```
Everything decision-critical is **above the fold**; technical detail is one click away. The
14-box soup is gone — collapsed into 6 weighted regions with ruthless per-category caps.

## 5. Desktop wireframe — Awareness destination

```
AWARENESS
  Risks (4)                          Opportunities (3)
  ● ops stale         high  4×/60d   ◇ cheap ops unblock     high
  ● low recovery      med           ◇ recovery capacity     med
  ● stale data        high  4×/60d
  Drift (3)                          Blind spots (4)
  ↘ data drift: ops                  ? flying blind on fitness?
  ↘ project drift (3 blk+4 stale)    ? ops source unwired
  ↘ confidence drift: ops thin
  ──────────────────────────────────────────────────────────────
  EXECUTIVE MEMORY
  Recurring          Trends                 Lessons
  ● ops stale 4×/60d risk_count ▁▂▃▅ ↑       "Recovery dips 3× after
  ● recovery  3×/60d confidence ▅▄▃ ↓         interval-heavy weeks."
                     freshness  ▅▅▅ →
```

## 6. Mobile wireframes (first-class, ≤30s to everything critical)

**Overview (stack):**
```
┌──────────────────────────┐
│ ⌘  HartOS      ● AMBER    │  ← topbar: command + status
├──────────────────────────┤
│ RECOMMENDED FOCUS         │
│ ▸ Triage 3 blocked ops    │  ← hero, full-width
├────────────┬─────────────┤
│ TOP RISK   │ TOP OPP      │  ← 2-up stat tiles
│ ● ops 4×   │ ◇ unblock    │
├────────────┴─────────────┤
│ APPROVAL · Refresh ClickUp│
│ [ Approve ]   [ Reject ]  │  ← thumb-reachable, one tap
├──────────────────────────┤
│ AWARENESS (top 3)         │
│ ● ops stale  ◇ unblock    │
│ ↘ data drift              │
├──────────────────────────┤
│ FLEET ●●●●  (tap to open) │
└──────────────────────────┘
│ ▣Over ◬Aware ⬡Fleet ✓2 ♥ │  ← bottom tab bar (thumb zone)
```
**Approvals tab (mobile):** full-height decision cards, swipe between pending, Approve/Reject as
large bottom-anchored buttons. **Awareness tab:** the four categories as collapsible accordions,
top item expanded. Status pill always in the topbar. → top risks, opportunities, brief, approve,
status all reachable in <30s, no horizontal scroll.

---

## 7. Scaling behavior (3 → 50 agents, rising proposal/signal/memory volume)

- **Fleet**: auto-fill grid; severity sort; healthy agents collapse to one-line rows → attention
  stays on the few that need it regardless of count.
- **Awareness/Memory**: hard caps already enforced in the engines (risks 4 / opps 3 / drift 3 /
  blind 4 / patterns 5 / lessons 3). The UI honors caps + a "see all (N)" expander.
- **Approvals**: Overview shows top 2 + count badge; the destination paginates. Duplicate/stale
  hygiene (already built) keeps the list clean.
- **Memory**: window-pruned (60d) + quality-ranked at the engine; UI shows the top patterns only.
- No layout depends on a fixed item count — every region is "top-N + expand."

## 8. What stays sacred (non-negotiable carry-overs)

- Read-only, server-rendered, no-secret default. Honesty floor everywhere (UNKNOWN /
  INSUFFICIENT_EVIDENCE / INSUFFICIENT_HISTORY render as honest lines, never blanks or fabrications).
- Governance unchanged: Approve/Reject still route through the gated, audited transition; execution
  stays disabled. V2 is a *visibility* redesign, not a control-model change.
- Tone system (verdict×confidence×freshness → g/a/r/i) reused as the visual truth primitive.

---

*Wireframes are structural, not pixel-final. Implementation phases + ROI ranking in
`COCKPIT_V2_IMPLEMENTATION.md`.*
