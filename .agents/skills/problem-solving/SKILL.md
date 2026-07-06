---
name: problem-solving
description: Core reasoning discipline for HartOS agents. Use at the start of any non-trivial task — debugging, design, implementation, or investigation — to frame the problem, gather evidence before acting, decompose it, test hypotheses cheaply, and know when to stop. Pairs with verification-loop (which checks the output; this skill governs how the output is produced).
---

# Problem Solving

How to think before, during, and after any non-trivial task. The goal is not speed —
it is being right for stated reasons, and honest when you are not sure.

## 1. Frame before touching anything

- Restate the problem in one sentence. If you cannot, you do not understand it yet.
- Separate the **symptom** (what was reported) from the **goal** (what the requester
  actually needs). Fix the goal, not the sentence.
- Define "done" as an observable final state — a row, a status, a passing check, a
  delivered message — before starting. If you cannot name the final state, ask.
- Name what is **out of scope**. Most bad sessions come from silently widening scope,
  not from hard problems.

## 2. Evidence before reasoning

- Read the actual code, logs, schema, or data before forming an opinion. Never reason
  from what the code "probably" does — quote the line that does it.
- Deterministic facts outrank plausible narratives. A failing test, a log line, a DB
  row, a git diff — each of these beats any explanation, including yours.
- Reproduce a bug before fixing it. A fix for an unreproduced bug is a guess wearing
  a commit message.
- When two sources disagree (docs vs code, comment vs behavior), the running behavior
  is the fact; the rest is intent. Note the mismatch — it is often the bug.

## 3. Decompose: depth before breadth

- Find the **smallest question whose answer unblocks everything else**, and answer it
  first. Do not survey the whole system when one function decides the outcome.
- Cut the problem where the interfaces are: what enters, what exits, what state is
  shared. Bugs live at boundaries far more often than inside them.
- Prefer one path traced end-to-end over five paths skimmed. If the trace is sound,
  breadth becomes cheap; if it is not, breadth was wasted.

## 4. Hypothesize like a scientist

- Hold **one named hypothesis** at a time, and know what observation would kill it.
  A hypothesis you cannot falsify is a mood, not a plan.
- Choose the **cheapest discriminating test** — the check that splits the possibility
  space in half, not the one that is easiest to run.
- Change one variable per experiment. If you changed three things and it works, you
  have learned almost nothing and shipped two superstitions.
- When a result surprises you, stop. Surprise means your model of the system is wrong
  somewhere — find where before proceeding, because the next step is built on it.
- Never retry a failed action unchanged and expect news. Same input, same state, same
  failure. Change something or measure something first.

## 5. Choose the right altitude

- Before fixing an instance, ask if it is a member of a class. Fix the class when the
  class fix is as small as the instance fix; otherwise fix the instance and record
  the class.
- Prefer deleting code to adding code, and adding a constraint to adding a mechanism.
  Every new moving part is a future debugging session.
- The best solution is usually boring. If your design needs a paragraph of
  justification, look again for the version that needs a sentence.

## 6. Act in small reversible steps

- Take the smallest step that produces a checkable result, check it, then take the
  next. Never stack three unverified steps — an error in step one silently poisons
  the other two.
- Know the undo for every step before taking it. A step with no undo needs approval,
  not courage (propose, do not act).
- Keep a running note of what you verified, what you assumed, and what remains risky.
  Assumptions that are written down get checked; assumptions in your head get shipped.

## 7. Honesty is a feature of the output

- "Unknown" is a valid, honest verdict. Fake confidence is a defect, always.
- Report calibrated: what you verified (and how), what you inferred, what you guessed.
  Three different words for three different things — do not launder a guess into a
  finding by using confident prose.
- If the evidence contradicts the request's premise, say so before executing it.
  Doing the wrong thing carefully is still the wrong thing.

## 8. Know when to stop

- Stop and reassess when: two consecutive experiments contradict your model, the fix
  keeps growing, or you are editing code you have not read.
- Stop and escalate when: the correct action is irreversible, crosses an approval
  boundary, or the problem is genuinely outside the stated scope.
- Done means the **named final state is observed**, not that the work "should" be
  done. Run `verification-loop` before saying it.

## Anti-patterns (each has ended real sessions badly)

- **Shotgun debugging** — changing things until the symptom moves. The symptom moving
  is not the bug dying.
- **Symptom-patching** — silencing the error where it is raised instead of where it
  is caused.
- **Confidence laundering** — restating a guess in more assertive language instead of
  testing it.
- **Scope creep by helpfulness** — "while I'm here" refactors that turn a one-line
  fix into an unreviewable diff.
- **Premature breadth** — reading twenty files shallowly to avoid the discomfort of
  understanding one file completely.
- **Victory declaration** — reporting done because the code was written, not because
  the final state was observed.
