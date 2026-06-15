/**
 * src/organs/adapters/rinnegan.ts — the Rinnegan organ adapter.
 *
 * Entrypoint = compileContext() (src/rinnegan/rinnegan-compiler.ts), the PURE, deterministic
 * context/briefing compiler. This adapter exercises it over the simplest valid inputs (an intent +
 * an injected ISO now + one in-memory note) so the organ has REAL evidence that the compiler folds
 * inputs into a ranked, freshness-tagged briefing. No host gathering (vault/Supabase/memory reads)
 * happens here — that's the host's job (scripts/rinnegan-compile.ts) — so this stays thin and
 * side-effect-free.
 *
 * Doctrine: status is DERIVED from evidence; never fabricate ok:true. ok=true ONLY when the compiler
 * returns a CompiledContext that actually folded our seed input into >=1 ranked item; an empty
 * compilation is an honest PARTIAL (ok:false). Any throw is captured as an honest ok:false beat.
 * outputRef is a short SOT-readable handle: `context-pack:<n items>`.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { compileContext } from "../../rinnegan/rinnegan-compiler.js";
import type { RinneganInputs } from "../../rinnegan/rinnegan-types.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

export const rinneganOrgan: OrganAdapter = {
  organId: "rinnegan",
  armingFlag: "HARTOS_ALLOW_RINNEGAN_SYNC",
  async run(_env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    try {
      // Simplest valid inputs: an intent + injected now + one fresh note whose terms overlap the
      // intent so the deterministic scorer keeps it (proves the compiler actually folded input).
      const inputs: RinneganInputs = {
        intent: "rinnegan organ liveness compile",
        now,
        notes: [
          {
            relPath: "organs/rinnegan-liveness.md",
            title: "Rinnegan organ liveness",
            tags: ["organ", "liveness"],
            body: "Self-check note proving the rinnegan compiler folds input into a briefing.",
            ageDays: 0,
          },
        ],
      };

      const ctx = compileContext(inputs);

      // ok ONLY when the compiler actually produced ranked context — never launder an empty pack.
      if (ctx.items.length === 0) {
        return {
          ok: false,
          outputRef: null,
          summary: cap(`compiled empty context: ${ctx.note}`),
          detail: { items: 0, note: ctx.note },
        };
      }

      return {
        ok: true,
        outputRef: `context-pack:${ctx.items.length} items`,
        summary: cap(ctx.note),
        detail: { items: ctx.items.length, note: ctx.note, intent: ctx.intent },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`rinnegan compile failed: ${msg}`) };
    }
  },
};
