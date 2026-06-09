/**
 * src/cockpit/mutation/card-target-resolver.ts
 *
 * Resolve "this operation" / "the stalled card" / a card id from a free-text instruction against
 * a SUPPLIED list of candidate ops cards. PURE + deterministic — no network, no clock, no store.
 *
 * Honesty (the whole point): HartOS never guesses a card. Resolution succeeds only when there is
 * an unambiguous match; otherwise it returns `ambiguous` (and lists the candidates) or `none`. A
 * wrong card is worse than no card.
 *
 * The candidate list is INJECTED by the caller (the live ops read-model populates it; the router
 * passes it via ctx.opsCards). With no candidates supplied, resolution is honest `no_candidates`.
 */

export interface OpsCardRef {
  cardId: string;
  cardName: string;
  /** Current ClickUp status (for the move's read-before-write `fromStatus`). */
  status: string;
}

export type ResolveStatus = "resolved" | "ambiguous" | "none" | "no_candidates";

export interface ResolveResult {
  status: ResolveStatus;
  target?: { cardId: string; cardName: string; currentStatus: string };
  /** Populated for `ambiguous` — the cards that matched, so the operator can disambiguate. */
  candidates?: OpsCardRef[];
  reason: string;
}

export interface ResolveOptions {
  /** The card the operator is currently focused on (clicked/viewing) — wins for "this/it". */
  focusedCardId?: string;
}

const FOCUS_REF = /\b(this|it|the (card|task|operation|project|one)|that)\b/i;
const STOP = new Set([
  "the", "this", "that", "it", "a", "an", "to", "on", "of", "and", "or", "for", "is", "has",
  "been", "put", "move", "set", "status", "card", "task", "operation", "project", "hold",
  "stalled", "stall", "pause", "park", "comment", "note", "please", "hartos", "in", "review",
  "progress", "waiting", "hart", "complete", "done",
]);

function tokens(s: string): string[] {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function toTarget(c: OpsCardRef): ResolveResult["target"] {
  return { cardId: c.cardId, cardName: c.cardName, currentStatus: c.status };
}

/**
 * Resolve the target card for an instruction. Order:
 *   1. An explicit card id in the text that matches a candidate.
 *   2. A focused card (operator is viewing it) + a focus reference ("this/it") in the text.
 *   3. A keyword match of the instruction against candidate names — unique strong match wins;
 *      multiple matches ⇒ ambiguous.
 *   4. A bare focus reference ("put it on hold") with exactly one candidate ⇒ that card.
 *   5. Otherwise none / no_candidates — never a guess.
 */
export function resolveCardTarget(instruction: string, cards: OpsCardRef[], opts: ResolveOptions = {}): ResolveResult {
  const text = (instruction || "").trim();
  if (!cards.length) {
    return { status: "no_candidates", reason: "No candidate ops cards were supplied — the read-only snapshot carries none. Wire the live ops card list to resolve targets." };
  }

  // 1. Explicit card id present in the instruction.
  const byId = cards.find((c) => c.cardId && text.toLowerCase().includes(c.cardId.toLowerCase()));
  if (byId) return { status: "resolved", target: toTarget(byId), reason: `Matched card id ${byId.cardId}.` };

  const hasFocusRef = FOCUS_REF.test(text);

  // 2. Focused card + a "this/it" reference.
  if (opts.focusedCardId && hasFocusRef) {
    const focused = cards.find((c) => c.cardId === opts.focusedCardId);
    if (focused) return { status: "resolved", target: toTarget(focused), reason: `Resolved "this" to the focused card ${focused.cardId}.` };
  }

  // 3. Keyword match against candidate names.
  const qt = tokens(text);
  if (qt.length) {
    const scored = cards
      .map((c) => ({ c, hits: tokens(c.cardName).filter((w) => qt.includes(w)).length }))
      .filter((x) => x.hits > 0)
      .sort((a, b) => b.hits - a.hits);
    if (scored.length === 1) return { status: "resolved", target: toTarget(scored[0]!.c), reason: `Unique name match on "${scored[0]!.c.cardName}".` };
    if (scored.length > 1 && scored[0]!.hits > scored[1]!.hits) {
      return { status: "resolved", target: toTarget(scored[0]!.c), reason: `Strongest name match on "${scored[0]!.c.cardName}".` };
    }
    if (scored.length > 1) {
      return { status: "ambiguous", candidates: scored.map((x) => x.c), reason: `${scored.length} cards match — name the card or its id.` };
    }
  }

  // 4. Bare focus reference with exactly one candidate.
  if (hasFocusRef && cards.length === 1) {
    return { status: "resolved", target: toTarget(cards[0]!), reason: `Only one candidate card — resolved "this" to it.` };
  }
  if (hasFocusRef) {
    return { status: "ambiguous", candidates: cards.slice(0, 8), reason: `"${text}" refers to a card but several are open — name it or its id.` };
  }

  return { status: "none", reason: "No card in the instruction matched a candidate — name the card or paste its id." };
}
