-- 20260612120000_daemon_heartbeats.sql
--
-- The DEAD-MAN'S-SWITCH bridge: the live-runner daemon writes a liveness heartbeat here (it cannot
-- alert on its OWN death — a dead process alerts nothing), and the always-on Cloudflare Worker cron
-- reads it and pings Hart on Telegram when the daemon goes SILENT (staleness) or marks itself errored.
-- Staleness is the real detector: a hard SIGKILL / power loss writes no 'error' status, so the only
-- honest signal is the absence of a fresh heartbeat.
--
-- Dedup lives HERE (last_alert_at), not in the daemon (whose memory dies with it) nor in the Worker
-- (stateless per cron tick). The RPC is SECURITY DEFINER so the Worker's read-only key may call it;
-- the only write it performs is its own alert-dedup bookkeeping — never any HartOS data.

create table if not exists public.daemon_heartbeats (
  daemon_id          text primary key,
  last_heartbeat_at  timestamptz not null default now(),
  status             text not null default 'alive',   -- 'alive' | 'error' | 'crashed'
  crash_reason       text,
  last_alert_at      timestamptz,                      -- alert-dedup latch (null = not currently alerting)
  updated_at         timestamptz not null default now()
);

-- Atomic check + dedup + recovery. Returns exactly one row. The Worker sends a Telegram message
-- only when should_alert is true; kind disambiguates a 'down' alert from a 'recovery' note.
create or replace function public.hartos_daemon_liveness_alert(
  p_daemon_id        text default 'live-runner',
  p_stale_seconds    int  default 360,    -- 2x the 300s heartbeat: silent longer than this ⇒ down
  p_cooldown_seconds int  default 1800    -- re-alert at most every 30 min while still down
)
returns table(should_alert boolean, kind text, status text, seconds_silent int, reason text)
language plpgsql
security definer
set search_path = public
as $$
declare
  r      public.daemon_heartbeats;
  secs   int;
  silent boolean;
begin
  select * into r from public.daemon_heartbeats where daemon_id = p_daemon_id;
  if not found then
    return query select false, 'none'::text, 'unknown'::text, 0, 'no heartbeat row yet'::text;
    return;
  end if;

  secs   := floor(extract(epoch from (now() - r.last_heartbeat_at)))::int;
  silent := secs > p_stale_seconds or r.status in ('error', 'crashed');

  if silent then
    -- edge-trigger + cooldown: alert on the first silence, then at most once per cooldown
    if r.last_alert_at is null or extract(epoch from (now() - r.last_alert_at)) > p_cooldown_seconds then
      update public.daemon_heartbeats set last_alert_at = now() where daemon_id = p_daemon_id;
      return query select
        true,
        'down'::text,
        r.status,
        secs,
        ('live-runner ' ||
         (case when r.status in ('error', 'crashed') then r.status else 'silent' end) ||
         ' — last heartbeat ' || secs || 's ago' ||
         coalesce(' · ' || r.crash_reason, ''))::text;
      return;
    end if;
    return query select false, 'down'::text, r.status, secs, 'still down (within cooldown)'::text;
    return;
  else
    -- healthy again: if we were alerting, emit ONE recovery note and clear the latch
    if r.last_alert_at is not null then
      update public.daemon_heartbeats set last_alert_at = null where daemon_id = p_daemon_id;
      return query select true, 'recovery'::text, r.status, secs, 'live-runner back online'::text;
      return;
    end if;
    return query select false, 'none'::text, r.status, secs, 'alive'::text;
    return;
  end if;
end;
$$;

-- The Worker calls this with the read-only (anon) key; SECURITY DEFINER lets it run the dedup write.
grant execute on function public.hartos_daemon_liveness_alert(text, int, int) to anon, authenticated, service_role;
