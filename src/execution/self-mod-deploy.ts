/**
 * src/execution/self-mod-deploy.ts — Phase 6 (Amendment §6): Tier-1 auto-deploy + post-deploy net.
 *
 * For a verified Tier-1 self-mod: commit → push to trunk → CI deploy → post-deploy verify. The
 * INVARIANT: a bad deploy is never left live. Every failure after the push (deploy fails, verify
 * fails, or a port throws) → revert to the last-good SHA + DISARM self-mod + alert Hart. If nothing
 * was pushed, just disarm + alert (no revert). disarm/notify are best-effort and never escape.
 * Pure orchestration over injectable ports; the real ports (git, CI, smoke, Telegram, the disarm
 * marker) are thin adapters wired separately. STILL DISARMED — no caller yet.
 */

export interface DeployPorts {
  /** Commit the verified change + push to the deploy branch. Returns the pushed SHA. */
  commitPush(): { ok: boolean; sha: string; detail: string };
  /** Trigger CI deploy of the pushed SHA + wait for it to finish. */
  deploy(sha: string): { ok: boolean; detail: string };
  /** Post-deploy check: smoke + health + deployed-SHA match. */
  verify(expectedSha: string): { ok: boolean; detail: string };
  /** Revert: reset the deploy branch to the last-good SHA + redeploy it. */
  revert(toSha: string): { ok: boolean; detail: string };
  /** Disarm self-mod (no more auto-applies until Hart re-arms). */
  disarm(reason: string): void;
  /** Notify/alert Hart (Telegram). */
  notify(message: string): void;
}

export type DeployOutcome = "deployed" | "deploy-failed" | "reverted" | "revert-failed";

export interface DeployResult {
  outcome: DeployOutcome;
  reason: string;
  deployedSha?: string;
  errors: string[];
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Disarm best-effort. Returns the failure detail if it THREW — a circuit breaker that didn't trip
 *  is as dangerous as a failed revert, so the caller surfaces it loudly rather than swallowing it. */
function safeDisarm(reason: string, ports: DeployPorts): string | null {
  try { ports.disarm(reason); return null; } catch (e) { return msg(e); }
}

/** Disarm + alert (best-effort, never throws). Used when nothing was pushed — no revert needed. */
function abortNoRevert(reason: string, ports: DeployPorts): DeployResult {
  const disarmErr = safeDisarm(reason, ports);
  const errors = [reason];
  if (disarmErr) {
    errors.push(`disarm failed: ${disarmErr}`);
    try { ports.notify(`⚠️ self-mod aborted (nothing deployed) but DISARM FAILED — manual recovery needed. ${reason} | disarm: ${disarmErr}`); } catch { /* best-effort */ }
  } else {
    try { ports.notify(`self-mod aborted (nothing deployed) + DISARMED: ${reason}`); } catch { /* best-effort */ }
  }
  return { outcome: "deploy-failed", reason, errors };
}

/** Revert to last-good + disarm + alert (best-effort). A failed revert OR a failed disarm is flagged
 *  loudly for manual recovery — outcome "revert-failed" means the automatic safety net did not fully complete. */
function revertAndDisarm(lastGoodSha: string, reason: string, ports: DeployPorts): DeployResult {
  let rev: { ok: boolean; detail: string };
  try {
    rev = ports.revert(lastGoodSha);
  } catch (e) {
    rev = { ok: false, detail: msg(e) };
  }
  const disarmErr = safeDisarm(reason, ports);
  const errors = [reason];
  if (!rev.ok) errors.push(`revert failed: ${rev.detail}`);
  if (disarmErr) errors.push(`disarm failed: ${disarmErr}`);
  if (!rev.ok || disarmErr) {
    const bits = [reason];
    if (!rev.ok) bits.push(`revert: ${rev.detail}`);
    if (disarmErr) bits.push(`DISARM FAILED: ${disarmErr}`);
    try { ports.notify(`⚠️ self-mod FAILED — manual recovery needed. ${bits.join(" | ")}`); } catch { /* best-effort */ }
    return { outcome: "revert-failed", reason, errors };
  }
  try { ports.notify(`self-mod reverted to ${lastGoodSha} + DISARMED: ${reason}`); } catch { /* best-effort */ }
  return { outcome: "reverted", reason, errors };
}

/** Deploy a verified Tier-1 change with an automatic post-deploy revert net. lastGoodSha = the SHA to revert to. */
export function deployAndVerifySelfMod(lastGoodSha: string, ports: DeployPorts): DeployResult {
  let pushedSha = "";
  try {
    const cp = ports.commitPush();
    if (!cp.ok) return abortNoRevert(`commit/push failed: ${cp.detail}`, ports);
    pushedSha = cp.sha;

    const dep = ports.deploy(pushedSha);
    if (!dep.ok) return revertAndDisarm(lastGoodSha, `deploy failed: ${dep.detail}`, ports);

    const ver = ports.verify(pushedSha);
    if (!ver.ok) return revertAndDisarm(lastGoodSha, `post-deploy verify failed: ${ver.detail}`, ports);

    try { ports.notify(`self-mod deployed + verified: ${pushedSha}`); } catch { /* best-effort */ }
    return { outcome: "deployed", reason: "deployed + post-deploy verified", deployedSha: pushedSha, errors: [] };
  } catch (e) {
    // A port threw. If the push landed, the bad change may be live → revert + disarm. Else just disarm.
    if (pushedSha) return revertAndDisarm(lastGoodSha, `port threw after push: ${msg(e)}`, ports);
    return abortNoRevert(`port threw before push: ${msg(e)}`, ports);
  }
}
