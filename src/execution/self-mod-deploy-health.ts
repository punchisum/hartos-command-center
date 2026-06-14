/**
 * src/execution/self-mod-deploy-health.ts — Phase 6 (Amendment §6): post-deploy verification.
 *
 * After a self-mod deploy, confirm prod is healthy AND serving the EXPECTED SHA — not merely that
 * some healthy build is up. The hosted Worker's /health returns { ok, version: <BUILD_SHA>, ... };
 * a pass requires ok===true AND version===expectedSha. Injectable fetch so tests are hermetic.
 * Never throws — a network error is a verification failure (fail-closed).
 */

export type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

export interface HealthResult {
  ok: boolean;
  /** The SHA prod reports it is serving (from /health.version), or null if unavailable. */
  servingSha: string | null;
  detail: string;
}

/** Check that <baseUrl>/health is ok AND serving expectedSha. Fail-closed; never throws. */
export async function checkDeployedSha(baseUrl: string, expectedSha: string, fetchFn: FetchLike = fetch as unknown as FetchLike): Promise<HealthResult> {
  const url = `${baseUrl.replace(/\/+$/, "")}/health`;
  try {
    const res = await fetchFn(url);
    if (!res.ok) {
      return { ok: false, servingSha: null, detail: `/health returned HTTP ${res.status}` };
    }
    const body = (await res.json()) as { ok?: unknown; version?: unknown };
    const servingSha = typeof body.version === "string" ? body.version : null;
    if (body.ok !== true) {
      return { ok: false, servingSha, detail: "/health reported not-ok" };
    }
    if (servingSha !== expectedSha) {
      return { ok: false, servingSha, detail: `deployed SHA "${servingSha}" != expected "${expectedSha}"` };
    }
    return { ok: true, servingSha, detail: "healthy and serving the expected SHA" };
  } catch (e) {
    return { ok: false, servingSha: null, detail: `/health fetch failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}
