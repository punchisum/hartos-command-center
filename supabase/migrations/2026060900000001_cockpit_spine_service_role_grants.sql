-- Phase E — grant the trusted service_role the DML it needs on the cockpit spine
-- tables, so the gated Edge Function (persist-cockpit-proposal), which authenticates
-- as service_role via PostgREST, can upsert. Without this the write is rejected
-- (the table was created with only REFERENCES/TRIGGER/TRUNCATE for service_role).
--
-- RLS stays ON and still denies anon/authenticated; service_role bypasses RLS but
-- PostgREST still requires table-level grants. SELECT/INSERT/UPDATE only — the
-- function upserts (merge-duplicates) and never deletes. Idempotent.

grant select, insert, update on table public.cockpit_proposals to service_role;
grant select, insert, update on table public.cockpit_threads to service_role;
