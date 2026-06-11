# OPERATION JARVIS — HartOS Command-Center Doctrine

> Beezulbub UX-intelligence mission, 2026-06-11. Scout → dissect → synthesize. **Doctrine, not a redesign.**
> Grounded in: a live Beezulbub OSS scout (scored repos, below), the canonical command-center corpus,
> and HartOS's real architecture (9 meta-agents, propose→approve→execute→learn spine, V3 cockpit).
> A cited deep-research report is running in parallel and will append verified specifics to Parts 1–3.

---

## The one-line thesis

**Command centers feel powerful not because of how they look, but because of a contract they keep:
_the system watches everything and shows it honestly; the human decides only what matters; and every
action is fast, grounded, and reversible._** Aesthetics (the glow, the rings, the bleeps) are the
thinnest layer — they only *land* when they ride on top of that contract. Get the contract wrong and
no amount of neon saves it; get it right and even a plain terminal (Bloomberg) feels like a throne.

HartOS already has the contract (it's the whole propose→approve→execute→audit→learn spine). The
cockpit's job is to *express* it. This doctrine is how.

---

## PART 1 — Top 20 command-center examples worth studying

Grouped by what each **uniquely** contributes (the reason to study it, not a description).

### Fiction (the feeling, abstracted)
1. **Iron Man JARVIS HUD** (Cantina Creative / Jayse Hansen) — *the system narrates its own thinking*: data assembles in front of you so computation feels alive and on-your-side. Lesson: motion = revealed reasoning, never decoration.
2. **Avengers / FRIDAY holo-tables** (Territory Studio) — *the shared 3D situational object* you walk around and manipulate; the UI is a place, not a page.
3. **Minority Report g-speak** (John Underkoffler / Oblong) — *direct spatial manipulation of information*; the real lesson isn't gestures (RSI hell) but **spatial organization** — things have a place and you move them.
4. **The Expanse tactical plot** — *honest physics*: range, bearing, light-lag, projected-vs-actual. The display tells the truth about **uncertainty and time**. The most HartOS-aligned fiction: it never fakes certainty.
5. **Star Trek LCARS** (Michael Okuda) — *calm, flat, label-driven*; color-coded zones, zero skeuomorphism, function names as the UI. Proof that "advanced" reads as **calm and legible**, not busy.
6. **Batman Batcomputer** — *one operator, total reach*: a single person commanding many systems from one seat. The personal-scale command center (closest to HartOS's actual user model: one Hart).
7. **Ender's Game battle room/command** — *delegation under a single commander*: you direct semi-autonomous units; you don't micro every one. The multi-agent fleet mental model.

### Real operations rooms (the discipline)
8. **NASA Mission Control (MCC)** — *console-per-discipline + GO/NO-GO polling + the front "big board."* Each subsystem has a station; the Flight Director polls them and the human says GO. This **is** HartOS's agent-per-domain + approval gate, 50 years early.
9. **SpaceX mission control** — *the same discipline, modernized into clean flat screens* + a public webcast layer (the same data, two audiences: operator vs observer).
10. **Air Traffic Control** — *alarm philosophy + the handoff protocol*: only conflicts alert; controllers hand aircraft off with an explicit, audited transfer. Lesson: **silence is information**; transfers are ceremonies.
11. **Power-grid control room (SCADA mimic)** — *the one-line topology diagram + dark-console philosophy* (ISA-18.2 alarm management): a healthy grid is DARK; only abnormal states light up. The anti-clutter doctrine in its purest form.
12. **Cybersecurity SOC / SIEM** — *triage tiers + the single pane of glass* — and its famous failure: **alert fatigue.** The cautionary tale: density without prioritization destroys command.
13. **Bloomberg Terminal** — *keyboard-first command language + density-as-power.* Ugly amber-on-black, function-code mnemonics, multi-monitor. Speed is the product; it makes a trader feel like a pro because it never slows them to a mouse.
14. **HFT / trading floor** — *latency discipline*: the interface is judged in milliseconds; nothing animates that delays a decision. The hard counter-weight to "make it cinematic."

### Modern products (the implementable patterns)
15. **Palantir Gotham / Foundry** — *the object-graph + provenance/lineage*: everything is an entity with relationships, and every datum shows where it came from. The "investigation surface" mental model.
16. **Anduril Lattice** — *the common operating picture + autonomy on-the-loop ("command by exception")*: sensors fuse into one map; autonomy acts within bounds; the human approves exceptions. **The single closest real-world analog to what HartOS is.**
17. **Linear** — *command-palette-first, opinionated calm density, optimistic UI*: keyboard ⌘K does everything; the UI is fast, quiet, and confident. The gold standard for "power without noise" at personal/team scale.
18. **Vercel** — *deployment status + live build logs as first-class*: the system's work is legible in real time; you watch it think and ship.
19. **Figma multiplayer** — *presence*: live cursors/avatars make a system feel **inhabited and alive** through other actors' real activity (HartOS analog: agents as live actors).
20. **Perplexity / Cursor / OpenAI Operator** — *citations + diffs + a visible action log with approval*: AI that **shows its sources, its proposed change, and asks before acting.** Exactly HartOS's honesty + approval floor, in a consumer skin.

> **Beezulbub live OSS scout (real, scored — for Part 8):** `arwes` (7.5k★, MIT — the actual sci-fi-UI framework), `builderz-labs/mission-control` (5.2k★, MIT — self-hosted multi-agent orchestration dashboard), `openclaw-mission-control` ×3 (4k/275/94★ — agent orchestration + real-time logs via Convex, no polling), `tenacitOS` (1.2k★), `clawport-ui` (880★, MIT — Claude-Code agent-team command center), `VertexGuard` (cyber "mission control" UX), `command-center-lite` (83★).

---

## PART 2 — Patterns discovered (the recurring structure)

Across all 20, the same skeleton recurs:

- **P1 · The Big Board** — one always-visible surface carrying the whole state (NASA front board, Anduril COP, grid mimic, Bloomberg multi-monitor). Glance = full awareness.
- **P2 · Exception surfacing** — the system filters; the human sees only what needs a decision (grid dark-console, SOC triage, ATC conflict alert, Anduril command-by-exception). *Silence means healthy.*
- **P3 · Provenance on everything** — every claim shows source + confidence + freshness (Palantir lineage, Perplexity citations, The Expanse uncertainty, Bloomberg auditability).
- **P4 · A command language** — keyboard/voice verbs beat clicking; muscle memory = speed = power (Bloomberg codes, Linear ⌘K, LCARS labels, JARVIS voice).
- **P5 · A spatial model** — fleet/map/graph/topology you navigate, not a list you scroll (Anduril map, Palantir graph, grid one-line, NASA console geography).
- **P6 · Role/console decomposition** — subsystems have stations; the commander composes them (NASA consoles, SOC tiers, Ender's units).
- **P7 · Diegetic motion** — animation that *means* a real change (data arriving, a job running, a state flip) — never decorative (JARVIS reveal, Expanse trajectory, Vercel build log).
- **P8 · Calm under stakes** — the drama is in the consequences, not the chrome. Real rooms are quiet (Kranz's calm, LCARS flat, Linear restraint).
- **P9 · An approval ceremony** — irreversible actions have an explicit, audited gate (NASA GO/NO-GO, ATC handoff, Operator's "approve"). The human floor.
- **P10 · Two audiences, one truth** — an operator-dense view and an at-a-glance/observer view of the *same* data (SpaceX webcast vs console; Bloomberg pro vs a glance).

---

## PART 3 — What makes interfaces feel powerful (the mechanisms, not the look)

The honest answer to "why does it feel powerful" — six mechanisms:

1. **Total awareness with zero hunting.** Power is the *absence of "where do I look?"* The whole state is one glance away. (The opposite — tabs, drill-downs, hidden state — feels like a toy.)
2. **The machine does the vigilance.** You feel commanding because you're not watching gauges — the system is, and it taps you only on exceptions. Delegation of attention is the core power fantasy, and it's real here, not theater.
3. **Trust through provenance.** You feel in control because you can *verify* — sources, confidence, freshness, audit trail. Fake confidence destroys the feeling instantly; honest uncertainty *strengthens* it (Expanse, Perplexity).
4. **Speed collapses the gap between intent and effect.** Type a verb → it happens. No latency, no mouse-hunting. Bloomberg and Linear feel powerful because thought ≈ action.
5. **Legible aliveness.** The system visibly *works* — jobs run, data flows, agents act — and every motion is tied to a real event. This is the ONE place aesthetics earn their keep: motion as the heartbeat of real computation.
6. **Bounded autonomy you can trust.** The system acts on its own within gates you set, and never crosses the line without asking. (Anduril on-the-loop = HartOS autoheal + approval floor.) Power = *leverage you didn't have to babysit.*

**The trap:** every one of these has an evil twin that *looks* the same but is hollow — fake density, fake provenance ("AI-generated," uncited), fake aliveness (decorative particles), fake autonomy (a spinner pretending to think). The whole game is keeping the mechanism real and letting the aesthetic only ever *reflect* it.

---

## PART 4 — HartOS VISUAL doctrine

Seven laws. (These extend the V3 skin already shipped; they don't replace it.)

1. **Calm-dark, exception-bright.** The resting cockpit is quiet and dark (grid dark-console). Color and motion are *spent*, not sprinkled — they only appear where something needs Hart. Green breathes slow; amber faster; red is rare and loud. A GREEN board should look almost asleep.
2. **Motion must be diegetic.** Every animation maps to a real event: a pulse ran, a proposal arrived, an agent flipped state, data is fresh/stale. The arc-reactor breathes because the system is *live*; the topology flows because agents *report*. **No motion without meaning** — already the V3 rule; make it law.
3. **Provenance is a visual primitive.** Confidence, freshness, and source are first-class chips on every claim — never hidden. "GREEN" always carries *why* and *as-of*. Honest empty states ("Nothing crossed the threshold — that's an honest read, not amnesia") over fake fullness.
4. **One glance = whole state.** The Overview is the Big Board: system core + the 2–3 decisions + fleet health + what needs approval, above the fold, on a laptop *and* a phone. Everything else is one keystroke away, never required.
5. **Monospace is the data voice; sans is the human voice.** Numbers, statuses, ids, timestamps in tabular monospace (Bloomberg/terminal authority); prose and guidance in sans. Already in V3 — codify it.
6. **Topology over lists.** The fleet is a *network you command*, not a table you read (Anduril/Palantir). The V3 fleet-graph is the seed; it becomes the primary agent surface as the fleet grows.
7. **Restraint scales; spectacle doesn't.** Every effect must survive the "still tasteful with 50 agents and at 7am on a phone?" test. When in doubt, cut it. The cockpit should make a SaaS dashboard look primitive by being *more disciplined*, not more decorated.

**Palette law (locked):** ice/cyan = core & primary, violet = accent, emerald = healthy, amber = attention, red = critical, deep-navy/black-glass = ground. **Banned:** gamer RGB, rainbow gradients, crypto neon, decorative particle storms, fake "scanning" theater, anything that implies certainty HartOS doesn't have.

---

## PART 5 — HartOS INTERACTION doctrine

Six laws.

1. **Command-first, click-second.** The Ask CLI + ⌘K palette are the primary verbs (Bloomberg/Linear). Hart should be able to *drive the whole OS from the keyboard* — ask, approve, run a report, summon an agent — without a mouse. Clicking is the fallback, not the path.
2. **Command by exception.** The loop proposes and (within armed gates) auto-executes the safe/reversible; Hart is interrupted only for what's outside the gates. The inbox is *decisions*, not noise. (This is the autoheal spine — the UI must reflect "I handled N things; here are the 2 that need you.")
3. **Approval is a ceremony, and it's honest.** Every gated action shows: what it does, why-approve, why-reject, blast radius, reversibility — then a single decisive Approve/Reject (NASA GO/NO-GO). Already built; keep it sacred. Nothing irreversible without it.
4. **Latency is a feature.** Optimistic UI on every action (Linear): the click registers instantly; reconciliation happens behind it. No spinner-as-theater. If the system is thinking, show *what* it's doing (Vercel build-log style), never a fake "AI is reasoning…".
5. **Drill-down is always available, never required.** Glance → peek (drawer) → full dashboard. Three depths, each one optional. Hart chooses the altitude; the system never forces a hunt.
6. **Everything is auditable and reversible.** Every action leaves an audit row; every mutation has a rollback path; the human can always ask "what did you do and why." Trust is the interaction substrate.

---

## PART 6 — HartOS command-center architecture (the conceptual model)

The mental model HartOS should commit to, in one sentence:

> **HartOS is an _operating system_ whose _kernel_ is the approval/execution spine, whose _processes_ are agents, whose _shell_ is the Ask command line, and whose _display server_ is the cockpit — a common operating picture of a fleet you command by exception.**

Four layers:

- **The Core (kernel).** The system heartbeat + the propose→approve→execute→audit→learn spine. Visually: the arc-reactor; conceptually: the one thing that's always alive and always honest. Its status IS the system's status.
- **The Fleet (processes).** The agents (Command, Fitness, Ops, Factory, Research, Prophet, Rinnegan, Beezulbub, Wolverine, …) as live entities with status/confidence/freshness/last-action — a topology, scaling to dozens. Each is a "console" (NASA) you can open to its full station.
- **The Shell (command line).** Ask CLI + ⌘K — the universal verb surface. Natural-language *and* mnemonic commands route to agents/actions. This is how Hart commands at speed as the fleet grows past what cards can show.
- **The Intelligence layer (the situational picture).** The fused, provenanced read: Today's Decisions (chief-of-staff synthesis), Strategic Awareness, Prophet forecast, Wolverine immune verdict, the learning track-record. The "big board" that turns raw agent state into *what matters now*.

As the fleet scales 10→50: **cards give way to the topology + search + exception-feed.** You don't render 50 cards; you render the *map*, the *2–3 decisions*, and a *command line* to reach any node. (This is the Palantir/Anduril answer to scale.)

---

## PART 7 — Concrete UI blueprint

The target layout (evolution of the shipped V3 shell, not a rewrite):

```
┌──────────────────────────────────────────────────────────────────────────┐
│  TOPBAR:  ⌘ Ask…            [HARTOS CORE · ONLINE ◉]   GREEN   ⟳ 3m ago    │  ← command line + system core + freshness
├──────┬───────────────────────────────────────────────────────┬───────────┤
│ RAIL │  THE BIG BOARD (Overview)                               │  ASK CLI  │
│ ◆    │  ┌─ System Core ──────┐ ┌─ Today's Decisions (2–3) ──┐  │  command  │
│ ▣ ov │  │ arc-reactor + the  │ │ ranked, with do/why/cost   │  │ terminal  │
│ ◬ int│  │ one-line verdict   │ │ + Approve inline           │  │ (persist) │
│ ✓ ap │  └────────────────────┘ └────────────────────────────┘  │           │
│ 🤖 fl│  ┌─ Exception Feed ──────────────────────────────────┐   │  live     │
│ ⚙ tc │  │ "Handled 4 · 2 need you" — the command-by-exc.    │   │  agent    │
│      │  └───────────────────────────────────────────────────┘   │  actions  │
│      │  ┌─ Fleet strip (health glance) ─────────────────────┐   │  scroll   │
│      │  └───────────────────────────────────────────────────┘   │  here     │
├──────┴───────────────────────────────────────────────────────┴───────────┤
│  Mobile: bottom-nav (Brief · Fleet · Intel · Approve · Ask)               │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Screen layout.** Overview = the Big Board (core + decisions + exception feed + fleet glance). Agents = the fleet topology (primary) + org panel (detail). Intelligence = knowledge/memory/forecast/synthesis. Approvals = the decision queue. Technical = diagnostics + system health. *(All five already exist — the change is making Overview a true big-board and adding the Exception Feed.)*
- **Navigation model.** ⌘K + Ask is primary; the rail is secondary; the topology is a third navigation surface (click a node → its console). Three ways to reach any agent; keyboard is fastest.
- **Fleet map.** The V3 SVG topology becomes interactive: nodes are clickable → open the agent's drawer/dashboard; edges pulse only when that agent *actually* reported/ran; tone = honest status. Scales by collapsing tiers + search, not by adding cards.
- **Command dock.** The Ask CLI (desktop right rail) / ⌘K palette (everywhere) — universal verbs: *ask, approve <id>, run report <x>, hunt <capability>, what changed?, show <agent>.* Mnemonic + natural-language.
- **Intelligence feed.** Today's Decisions at the top of Overview (the chief-of-staff synthesis), with Strategic Awareness / Prophet / Wolverine / learning-efficacy beneath. Every item provenanced.
- **System core.** The arc-reactor = the kernel heartbeat; its tone is the fused system verdict; clicking it → the deepest diagnostics. The emotional + functional center.
- **Agent cards.** Each: icon, name, **honest status pill** (verdict), confidence·freshness, top-3 facts (monospace), last action, and — when active — a *real* pulse tied to a real run. Card → drawer (peek) → full dashboard (dive).

**Net-new vs already-shipped:** the **Exception Feed** ("handled N, M need you") is the one genuinely new primitive — it's the visual face of command-by-exception and the autoheal loop. Everything else is sharpening V3 toward the doctrine.

---

## PART 8 — Steal Score

Rated 1–5 on **Usefulness · Originality · Implementation difficulty (1=easy) · HartOS fit.** "Steal" = the specific thing to take.

### Concept systems
| System | Use | Orig | Difficulty | Fit | Steal this |
|---|---|---|---|---|---|
| **Anduril Lattice** | 5 | 5 | 4 | **5** | Command-by-exception + COP + on-the-loop autonomy. The north star. |
| **NASA MCC** | 5 | 4 | 2 | **5** | GO/NO-GO approval ceremony + console-per-discipline. (Already have it — name it.) |
| **Bloomberg Terminal** | 5 | 4 | 2 | 5 | Keyboard command language + density-as-power + monospace authority. |
| **Linear** | 5 | 4 | 2 | 5 | ⌘K-first, optimistic UI, opinionated calm. Directly portable. |
| **Palantir Gotham** | 4 | 5 | 5 | 4 | Object-graph + provenance/lineage on every datum. |
| **Grid SCADA (dark console)** | 5 | 3 | 1 | 5 | Dark-console / ISA-18.2 alarm philosophy — silence = healthy. Cheap + huge. |
| **The Expanse plot** | 4 | 4 | 2 | 5 | Honest uncertainty + time/freshness made visible. Pure HartOS values. |
| **Perplexity/Operator** | 4 | 3 | 2 | 5 | Citations + visible action log + approve-before-act. |
| **JARVIS HUD (FUI)** | 3 | 5 | 4 | 3 | Diegetic reveal motion. Take the *principle*, not the spectacle. |
| **Figma multiplayer** | 3 | 4 | 3 | 3 | Presence — agents as live actors (a "who's working now" layer). |
| **SOC/SIEM** | 3 | 2 | 2 | 4 | The *cautionary tale*: triage tiers, and alert-fatigue as the enemy to design against. |
| **Minority Report / LCARS / Batcomputer** | 2–3 | 4 | 5/1/3 | 2–4 | Spatial organization (MR), flat calm legibility (LCARS), one-operator-total-reach (Bat). |

### Beezulbub OSS scout (real repos — digest before any absorb)
| Repo | ★ | License | Use | Diff | Fit | Verdict |
|---|---|---|---|---|---|---|
| **arwes** | 7.5k | MIT | 4 | 4 | 3 | **STUDY, don't devour.** React framework; HartOS cockpit is server-rendered vanilla. Steal its *patterns* (assemble/disassemble frames, diegetic bleeps, frame system), reimplement in CSS. |
| **builderz-labs/mission-control** | 5.2k | MIT | 5 | 3 | 4 | **DIGEST.** Closest shape: multi-agent dispatch + spend + governance. Mine its IA/layout for the fleet+exception surfaces. |
| **openclaw-mission-control** (×3) | 4k/275/94 | MIT/Apache | 4 | 3 | 4 | **DIGEST one** (the Convex real-time/no-polling one) for live-log + agent-activity patterns. |
| **tenacitOS** | 1.2k | MIT | 3 | 3 | 3 | Reference for dashboard polish. |
| **clawport-ui** | 880 | MIT | 4 | 3 | 4 | Claude-Code agent-team command center — most architecturally adjacent to HartOS's actual substrate. |
| **VertexGuard** | — | unknown | 2 | 3 | 3 | SOC-style "mission control" UX reference; license unknown → study only, never copy. |
| **command-center-lite** | 83 | unknown | 2 | 2 | 2 | Low signal; skip. |

> **Absorb protocol (doctrine):** Beezulbub *proposes*; nothing is copied without `beezulbub:digest` (poison/license/security scan + 7-dim score + DEVOUR/REJECT verdict + adaptation plan) **and Hart's approval.** `arwes` and the unknown-license repos are **study-only** (reimplement the idea; never lift the code). MIT repos are digest-eligible.

---

## The single most important takeaway

HartOS doesn't need to *look* more like JARVIS. It needs to **be** the thing JARVIS only pretended to be — a system that watches honestly, decides on your behalf within bounds you trust, acts reversibly, and shows its work — and then let the cockpit *express* that truth with calm, diegetic, exception-bright restraint. The contract is already built. The doctrine above is how the surface earns the feeling the contract makes possible.

When HartOS runs 50 agents, the operator should still feel exactly one thing: **"I am commanding a fleet, and it has my back."**

— Beezulbub, UX intelligence. *Scouted, dissected, synthesized. No code redesigned — by design.*
