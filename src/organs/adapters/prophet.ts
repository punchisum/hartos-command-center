/**
 * src/organs/adapters/prophet.ts — the Prophet organ adapter.
 *
 * Prophet's core is `forecast(input)` (src/prophet/forecast.ts) — a PURE, deterministic
 * consequence-of-inaction synthesis. Every input except `now` is optional, so this adapter
 * can assemble the simplest valid input (just the run clock) and get a REAL forecast back:
 * with no perception/wolverine/memory/etc., the projection is honestly `stable` and carries
 * each absent source as an explicit blind spot. That is genuine evidence, not fabrication —
 * Prophet is built to be honest about scope, so an empty-input forecast is a truthful pulse.
 *
 * Doctrine: status DERIVED from evidence; never fake ok:true. ok=true means forecast()
 * returned a report; outputRef is a short verdict handle the cockpit can read back. Any
 * throw is captured as an honest ok:false.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { forecast, summarizeForecast } from "../../prophet/forecast.js";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

export const prophetOrgan: OrganAdapter = {
  organId: "prophet",
  armingFlag: "HARTOS_ALLOW_PROPHET_PULSE",
  async run(_env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    try {
      // Simplest valid input: just the run clock. forecast() is pure and treats every other
      // input as optional, projecting `stable` + explicit blind spots when none are supplied.
      const report = forecast({ now });
      return {
        ok: true,
        outputRef: `forecast:${report.verdict}`,
        summary: cap(summarizeForecast(report)),
        detail: {
          verdict: report.verdict,
          consequenceCount: report.consequences.length,
          scanned: report.scanned,
          blindSpotCount: report.blindSpots.length,
        },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`prophet forecast failed: ${msg}`) };
    }
  },
};
