/**
 * src/organs/adapters/beezulbub.ts — the Beezulbub organ adapter.
 *
 * Entrypoint = runBeezulbubHunt(target, env, now) (scripts/beezulbub-hunt.ts), which live-scouts
 * GitHub for a capability target, renders a capability-scout dossier, files it into the vault
 * (gated), and returns { lines, report, target }. It is read-only + propose-only: it discovers and
 * reports; it never clones/copies/absorbs code. This adapter is THIN — it calls that fn with a
 * benign default target and maps its honest result onto the OrganRunResult contract. It adds NO new
 * external side-effects beyond what the gated entrypoint already does.
 *
 * Gating (fail-closed, enforced INSIDE the entrypoint): live network search needs
 * BEEZULBUB_ALLOW_NETWORK=true; absent it the scout falls back to fixtures, honestly labelled
 * (result mode !== "live"). The supervisor's arming gate (armingFlag) means run() is normally only
 * called when armed, but we still re-read the hunt's OWN honesty signal — the scout mode — so a
 * fixtures-only run is reported as an honest PARTIAL (ok:false), never fabricated as ok:true.
 *
 * Doctrine: status is DERIVED from evidence; never fake ok:true. ok=true means the hunt ran a REAL
 * live scout AND filed a dossier into SOT (the vault) we can read back. A disarmed/fixtures run, or
 * a run that produced no SOT-readable dossier, is an honest ok:false PARTIAL. Any throw → ok:false.
 *
 * outputRef = the vault-relative dossier path the hunt filed (a SOT-readable handle the cockpit can
 * read back), parsed from the hunt's own "vault: FILED → <relPath>" report line; null if the note
 * was not written (vault unconfigured / write disarmed / secret-guarded / fixtures-only).
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";
import { runBeezulbubHunt } from "../../../scripts/beezulbub-hunt.js";

/** A benign, registered capability target so a default pulse scouts something real but harmless. */
const DEFAULT_TARGET = "general";

/** Trim the honest summary to the contract's <300-char budget. */
function cap(s: string): string {
  return s.length > 299 ? s.slice(0, 299) : s;
}

/**
 * Pull the SOT-readable dossier handle out of the hunt's own report lines. The entrypoint prints
 * `  vault: FILED → <relPath>` only when the note actually landed in the vault — so a parsed path
 * is genuine evidence the dossier exists in SOT, not an assumption. Returns null otherwise.
 */
function extractDossierRef(lines: string[]): string | null {
  for (const line of lines) {
    const idx = line.indexOf("FILED → ");
    if (idx !== -1) {
      const rel = line.slice(idx + "FILED → ".length).trim();
      if (rel.length > 0) return rel;
    }
  }
  return null;
}

/** Was the scout a REAL live network scout (not a fixtures fallback)? Read from the hunt's own line. */
function ranLive(lines: string[]): boolean {
  // The hunt prints `Scout: mode=live · …` on a live run, and `mode=fixture`/`mode=manual` otherwise.
  return lines.some((l) => /\bmode=live\b/.test(l));
}

export const beezulbubOrgan: OrganAdapter = {
  organId: "beezulbub",
  armingFlag: "BEEZULBUB_ALLOW_NETWORK",
  async run(env: NodeJS.ProcessEnv, now: string): Promise<OrganRunResult> {
    try {
      const { lines } = await runBeezulbubHunt(
        DEFAULT_TARGET,
        env as Record<string, string | undefined>,
        now,
      );
      const outputRef = extractDossierRef(lines);
      const live = ranLive(lines);
      // The hunt's last informative line is the honest pulse (vault status / honest-read note).
      const lastLine = [...lines].reverse().find((l) => l.trim().length > 0)?.trim() ?? "";

      // ok:true ONLY when it was a real live scout AND a dossier landed in SOT we can read back.
      // Anything less (fixtures fallback, or no note filed) is an honest PARTIAL — never fabricated.
      if (live && outputRef) {
        return {
          ok: true,
          outputRef,
          summary: cap(`Beezulbub hunt (live) — dossier filed → ${outputRef}`),
          detail: { target: DEFAULT_TARGET, live: true, dossierRef: outputRef, lastLine },
        };
      }

      const reason = !live
        ? "fixtures-only (BEEZULBUB_ALLOW_NETWORK not armed for a live GitHub scout)"
        : "no dossier filed to SOT (vault unconfigured / write disarmed)";
      return {
        ok: false,
        outputRef,
        summary: cap(`Beezulbub hunt PARTIAL — ${reason}. ${lastLine}`),
        detail: { target: DEFAULT_TARGET, live, dossierRef: outputRef, lastLine },
      };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: cap(`beezulbub hunt failed: ${msg}`) };
    }
  },
};
