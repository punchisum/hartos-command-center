/**
 * src/organs/adapters/cockpit.ts — the cockpit organ adapter.
 *
 * Entrypoint = a real SOT readback: probe the LIVE Worker's /health and report what it says.
 * Doctrine: status is DERIVED from evidence; we NEVER fabricate ok:true. ok mirrors json.ok exactly,
 * outputRef is the deployed build version (a SOT-readable handle the cockpit can reconcile against),
 * and any failure (network, non-JSON, missing fields) is an HONEST ok:false beat. Thin adapter:
 * one read-only fetch, no new side-effects, always-on (armingFlag null) because a probe is read-only.
 */
import type { OrganAdapter } from "../organ-supervisor.js";
import type { OrganRunResult } from "../organ-contract.js";

const DEFAULT_COCKPIT_URL = "https://hartos-command-center.hartos.workers.dev";

export const cockpitOrgan: OrganAdapter = {
  organId: "cockpit",
  armingFlag: null,
  async run(env: NodeJS.ProcessEnv, _now: string): Promise<OrganRunResult> {
    try {
      const base = env.HARTOS_COCKPIT_URL ?? DEFAULT_COCKPIT_URL;
      const res = await fetch(`${base}/health`);
      const json = (await res.json()) as { ok?: unknown; mode?: unknown; version?: unknown };
      const ok = json.ok === true;
      const outputRef = typeof json.version === "string" ? json.version : null;
      const summary = `${String(json.mode)} ${String(json.version)}`.slice(0, 300);
      return { ok, outputRef, summary, detail: { status: res.status, ...json } };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ok: false, outputRef: null, summary: `health probe failed: ${msg}`.slice(0, 300) };
    }
  },
};
