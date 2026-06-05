/**
 * tests/destructive-sql-scan.test.ts
 *
 * Phase 18C — destructive-SQL scanner. Pure unit tests, no fs/network.
 * The headline test is the COMMENT TRAP: the factory scaffold ships a migration that
 * documents `drop constraint ...;` inside a `--` comment. The scanner MUST strip comments
 * first and NOT flag it. Also: safe DDL (create table/index, RLS-enable) must pass; real
 * destructive ops must be flagged; DELETE is destructive only without WHERE.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { scanSql, stripSqlComments, hashSql } from "../src/supabase/destructive-sql-scan.js";

// A faithful excerpt of the real generated 2026..._schema_contract.sql: an active, safe
// CREATE TABLE plus a `drop constraint` that lives ONLY inside the `--` comment block.
const SCHEMA_CONTRACT_EXCERPT = `
-- ─── STEP 2: Create the table with matching CHECK constraint ──────────────────
create table if not exists public.example_records (
  id          uuid       primary key default gen_random_uuid(),
  status      text       not null    default 'pending'
                check (status in ('pending', 'processing', 'done', 'failed', 'degraded')),
  metadata    jsonb      not null    default '{}'::jsonb
);

alter table public.example_records enable row level security;

-- ─── STEP 4: Adding a new status (safe migration pattern) ────────────────────
-- alter table public.example_records
--   drop constraint example_records_status_check;
-- alter table public.example_records
--   add constraint example_records_status_check
--     check (status in ('pending', 'processing', 'done', 'failed', 'degraded', 'new_status'));
`;

describe("18C destructive-sql-scan", () => {
  it("COMMENT TRAP: drop constraint inside a -- comment is NOT flagged", () => {
    const r = scanSql(SCHEMA_CONTRACT_EXCERPT);
    assert.equal(r.clean, true, `expected clean, got findings: ${JSON.stringify(r.findings)}`);
    assert.equal(r.risk, "safe");
  });

  it("strips line and block comments while preserving line numbers", () => {
    const stripped = stripSqlComments("a\n-- drop table x\nb /* drop schema y */ c\n");
    assert.equal(/drop\s+table/i.test(stripped), false);
    assert.equal(/drop\s+schema/i.test(stripped), false);
    // newlines preserved → same line count
    assert.equal(stripped.split("\n").length, "a\n-- drop table x\nb /* drop schema y */ c\n".split("\n").length);
  });

  it("allows safe additive DDL: create table / index / extension / RLS-enable / function / grant", () => {
    const safe = `
      create extension if not exists pgcrypto;
      create table if not exists public.agent_runs (id uuid primary key);
      create index if not exists agent_runs_id_idx on public.agent_runs (id);
      alter table public.agent_runs enable row level security;
      create or replace function public.f() returns int language sql as $$ select 1 $$;
      grant select on public.agent_runs to anon;
      create policy p on public.agent_runs for select using (true);
    `;
    const r = scanSql(safe);
    assert.equal(r.clean, true, JSON.stringify(r.findings));
  });

  it("flags DROP TABLE as irreversible", () => {
    const r = scanSql("drop table public.users;");
    assert.equal(r.risk, "irreversible");
    assert.ok(r.findings.some((f) => f.rule === "DROP_TABLE"));
  });

  it("flags TRUNCATE and DROP SCHEMA as irreversible", () => {
    assert.equal(scanSql("truncate table t;").risk, "irreversible");
    assert.equal(scanSql("drop schema public cascade;").risk, "irreversible");
  });

  it("flags ALTER TABLE ... DROP COLUMN but NOT enable RLS", () => {
    const drop = scanSql("alter table t drop column c;");
    assert.ok(drop.findings.some((f) => f.rule === "ALTER_DROP_COLUMN"));
    const rls = scanSql("alter table t enable row level security;");
    assert.equal(rls.clean, true);
  });

  it("DELETE without WHERE is destructive; DELETE with WHERE is safe", () => {
    assert.equal(scanSql("delete from t;").risk, "destructive");
    assert.equal(scanSql("delete from t where id = 1;").clean, true);
  });

  it("flags DROP POLICY and DISABLE RLS as destructive (security regression)", () => {
    assert.ok(scanSql("drop policy p on t;").findings.some((f) => f.rule === "DROP_POLICY"));
    assert.ok(scanSql("alter table t disable row level security;").findings.some((f) => f.rule === "DISABLE_RLS"));
  });

  it("reports the line number of the offending statement", () => {
    const r = scanSql("create table x (id int);\n\ndrop table y;\n");
    const f = r.findings.find((x) => x.rule === "DROP_TABLE");
    assert.ok(f);
    assert.equal(f!.line, 3);
  });

  it("hashSql is stable and content-sensitive", () => {
    assert.equal(hashSql("abc"), hashSql("abc"));
    assert.notEqual(hashSql("abc"), hashSql("abd"));
    assert.equal(hashSql("abc").length, 64);
  });
});
