/**
 * src/execution/self-mod-deploy.ts — Phase 6 (Amendment §6): Tier-1 auto-deploy + post-deploy net.
 *
 * For a verified Tier-1 self-mod: commit → push to trunk → CI deploy → post-deploy verify. The
 * INVARIANT: a bad deploy is never left live. Every failure after the push (deploy fails, verify
 * fails, or a port throws) → revert to the last-good SHA + DISARM self-mod + alert Hart. If nothing
 * was pushed, just disarm + alert (no revert). disarm/notify are best-effort and never escape.
 * Pure orchestration over injectable ports; the real ports (git, CI, smoke, Telegram, the disarm
 * marker) are thin adapters wired separately. ASYNC: each port may return sync or a Promise; the
 * orchestration awaits each, so a thrown/rejected port still routes through the revert net. STILL
 * DISARMED — no caller yet.
 */

/** A port may return its value synchronously or as a Promise. */
type MaybeP<T> = T | Promise<T>;

export interface DeployPorts {
  /** Commit the verified change + push to the deploy branch. Returns the pushed SHA. */
  commitPush(): MaybeP<{ ok: boolean; sha: string; detail: string }>;
  /** Trigger CI deploy of the pushed SHA + wait for it to finish. */
  deploy(sha: string): MaybeP<{ ok: boolean; detail: string }>;
  /** Post-deploy check: smoke + health + deployed-SHA match. */
  verify(expectedSha: string): MaybeP<{ ok: boolean; detail: string }>;
  /** Revert: reset the deploy branch to the last-good SHA + redeploy it. */
  revert(toSha: string): MaybeP<{ ok: boolean; detail: string }>;
  /** Disarm self-mod (no more auto-applies until Hart re-arms). */
  disarm(reason: string): MaybeP<void>;
  /** Notify/alert Hart (Telegram). */
  notify(message: string): MaybeP<void>;
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
async function safeDisarm(reason: string, ports: DeployPorts): Promise<string | null> {
  try { await ports.disarm(reason); return null; } catch (e) { return msg(e); }
}

/** Disarm + alert (best-effort, never throws). Used when nothing was pushed — no revert needed. */
async function abortNoRevert(reason: string, ports: DeployPorts): Promise<DeployResult> {
  const disarmErr = await safeDisarm(reason, ports);
  const errors = [reason];
  if (disarmErr) {
    errors.push(`disarm failed: ${disarmErr}`);
    try { await ports.notify(`⚠️ self-mod aborted (nothing deployed) but DISARM FAILED — manual recovery needed. ${reason} | disarm: ${disarmErr}`); } catch { /* best-effort */ }
  } else {
    try { await ports.notify(`self-mod aborted (nothing deployed) + DISARMED: ${reason}`); } catch { /* best-effort */ }
  }
  return { outcome: "deploy-failed", reason, errors };
}

/** Revert to last-good + disarm + alert (best-effort). A failed revert OR a failed disarm is flagged
 *  loudly for manual recovery — outcome "revert-failed" means the automatic safety net did not fully complete. */
async function revertAndDisarm(lastGoodSha: string, reason: string, ports: DeployPorts): Promise<DeployResult> {
  let rev: { ok: boolean; detail: string };
  try {
    rev = await ports.revert(lastGoodSha);
  } catch (e) {
    rev = { ok: false, detail: msg(e) };
  }
  const disarmErr = await safeDisarm(reason, ports);
  const errors = [reason];
  if (!rev.ok) errors.push(`revert failed: ${rev.detail}`);
  if (disarmErr) errors.push(`disarm failed: ${disarmErr}`);
  if (!rev.ok || disarmErr) {
    const bits = [reason];
    if (!rev.ok) bits.push(`revert: ${rev.detail}`);
    if (disarmErr) bits.push(`DISARM FAILED: ${disarmErr}`);
    try { await ports.notify(`⚠️ self-mod FAILED — manual recovery needed. ${bits.join(" | ")}`); } catch { /* best-effort */ }
    return { outcome: "revert-failed", reason, errors };
  }
  try { await ports.notify(`self-mod reverted to ${lastGoodSha} + DISARMED: ${reason}`); } catch { /* best-effort */ }
  return { outcome: "reverted", reason, errors };
}

/** Deploy a verified Tier-1 change with an automatic post-deploy revert net. lastGoodSha = the SHA to revert to.
 *  Once the baseline is taken, ANY port throw triggers a best-effort revert/disarm — an exception never escapes. */
export async function deployAndVerifySelfMod(lastGoodSha: string, ports: DeployPorts): Promise<DeployResult> {
  let pushedSha = "";
  try {
    const cp = await ports.commitPush();
    if (!cp.ok) return await abortNoRevert(`commit/push failed: ${cp.detail}`, ports);
    pushedSha = cp.sha;

    const dep = await ports.deploy(pushedSha);
    if (!dep.ok) return await revertAndDisarm(lastGoodSha, `deploy failed: ${dep.detail}`, ports);

    const ver = await ports.verify(pushedSha);
    if (!ver.ok) return await revertAndDisarm(lastGoodSha, `post-deploy verify failed: ${ver.detail}`, ports);

    try { await ports.notify(`self-mod deployed + verified: ${pushedSha}`); } catch { /* best-effort */ }
    return { outcome: "deployed", reason: "deployed + post-deploy verified", deployedSha: pushedSha, errors: [] };
  } catch (e) {
    // A port threw. If the push landed, the bad change may be live → revert + disarm. Else just disarm.
    if (pushedSha) return await revertAndDisarm(lastGoodSha, `port threw after push: ${msg(e)}`, ports);
    return await abortNoRevert(`port threw before push: ${msg(e)}`, ports);
  }
}
