/**
 * src/jobs/daemon-heartbeat-store.ts — the daemon's "I am alive" write (dead-man's-switch source).
 *
 * The live-runner upserts a heartbeat row every interval so an EXTERNAL observer (the Cloudflare
 * Worker cron) can detect its silence and alert Hart — a process cannot honestly alert on its own
 * death. Best-effort: a DB blip must NEVER crash the daemon, so callers swallow the result. The
 * error handlers also mark status='error' as a courtesy (a hard SIGKILL writes nothing, which is
 * exactly why staleness — not the status — is the real detector on the read side).
 */

export const DAEMON_ID = "live-runner";

export type DaemonStatus = "alive" | "error" | "crashed";

const UPSERT_SQL = `
  insert into public.daemon_heartbeats (daemon_id, last_heartbeat_at, status, crash_reason, updated_at)
  values ($1, now(), $2, $3, now())
  on conflict (daemon_id) do update
    set last_heartbeat_at = excluded.last_heartbeat_at,
        status            = excluded.status,
        crash_reason      = excluded.crash_reason,
        updated_at        = now()`;

interface DbHandle {
  query(sql: string, params: unknown[]): Promise<{ rows: unknown[] }>;
  close(): Promise<void>;
}

/**
 * Upsert the live-runner heartbeat. `makeDb` builds a fresh handle (the daemon passes
 * `() => createCockpitProposalDb(process.env)`; tests pass a fake). Returns true on a successful
 * write, false when the spine is not configured. Never throws — the daemon's liveness is more
 * important than any single heartbeat write.
 */
export async function writeDaemonHeartbeat(
  makeDb: () => DbHandle | null,
  status: DaemonStatus,
  reason?: string,
): Promise<boolean> {
  const handle = makeDb();
  if (!handle) return false;
  try {
    await handle.query(UPSERT_SQL, [DAEMON_ID, status, reason ?? null]);
    return true;
  } finally {
    await handle.close();
  }
}
