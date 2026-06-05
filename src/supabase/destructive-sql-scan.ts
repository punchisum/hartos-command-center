/**
 * src/supabase/destructive-sql-scan.ts
 *
 * Phase 18C — destructive-SQL safety scanner for generated-agent migrations.
 *
 * This is the core safety gate for the FIRST real external DB mutation in HartOS.
 * It is a PURE module: no fs, no network, no env. Callers feed it SQL text.
 *
 * Design rules (grounded in real generated migrations):
 *   - MUST strip SQL comments BEFORE pattern matching. The factory scaffold ships
 *     `2026..._schema_contract.sql` which documents a `drop constraint ...;` inside a
 *     `--` comment block. A naive grep would false-positive and block a safe migration.
 *   - MUST NOT blanket-reject ALTER TABLE: generated migrations use
 *     `alter table ... enable row level security`, which is benign. Only the destructive
 *     suffixes (DROP COLUMN / DROP CONSTRAINT) are rejected.
 *   - DELETE is only destructive WITHOUT a WHERE clause.
 *   - Default-deny on ambiguity is the caller's policy; this module reports findings and a
 *     conservative `risk` verdict, and the orchestrator decides (override gate).
 *
 * Hashing: SHA-256 of the RAW file bytes (not the stripped text) — drives the immutability
 * check (a previously-applied migration whose content changed is flagged upstream).
 */

import { createHash } from "node:crypto";

export type SqlRisk = "safe" | "destructive" | "irreversible";

export interface SqlFinding {
  /** Rule id, e.g. "DROP_TABLE". */
  rule: string;
  /** Human-readable description of what was matched. */
  description: string;
  risk: Exclude<SqlRisk, "safe">;
  /** 1-based line number within the comment-stripped SQL where the match occurred. */
  line: number;
  /** The trimmed offending statement fragment (safe — DDL only, never carries secrets). */
  snippet: string;
}

export interface SqlScanResult {
  /** Overall verdict: "safe" if no findings, else the highest risk found. */
  risk: SqlRisk;
  findings: SqlFinding[];
  /** True when every finding is benign (no findings). Convenience for callers. */
  clean: boolean;
}

// ─── Comment stripping ────────────────────────────────────────────────────────

/**
 * Remove SQL comments so destructive patterns inside documentation/comments are not
 * mistaken for real statements. Handles `-- line comments` and `/* block comments *​/`.
 * String/identifier literals are NOT comment-aware here: this is a conservative scanner,
 * not a full SQL parser. We only need comment removal to avoid the documented false
 * positives; literals containing `--` are rare in migrations and erring toward scanning
 * MORE text is fail-safe (a false positive blocks until override, never auto-applies).
 */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;
  let inLine = false;
  let inBlock = false;
  let inSingle = false; // '...'
  let inDouble = false; // "..."

  while (i < n) {
    const c = sql[i]!;
    const next = i + 1 < n ? sql[i + 1]! : "";

    if (inLine) {
      if (c === "\n") {
        inLine = false;
        out += c; // keep newline so line numbers are preserved
      }
      i++;
      continue;
    }
    if (inBlock) {
      if (c === "*" && next === "/") {
        inBlock = false;
        i += 2;
        continue;
      }
      if (c === "\n") out += c; // preserve line numbering through block comments
      i++;
      continue;
    }
    if (inSingle) {
      out += c;
      if (c === "'") inSingle = false;
      i++;
      continue;
    }
    if (inDouble) {
      out += c;
      if (c === '"') inDouble = false;
      i++;
      continue;
    }

    // Not in any comment/literal.
    if (c === "-" && next === "-") {
      inLine = true;
      i += 2;
      continue;
    }
    if (c === "/" && next === "*") {
      inBlock = true;
      i += 2;
      continue;
    }
    if (c === "'") {
      inSingle = true;
      out += c;
      i++;
      continue;
    }
    if (c === '"') {
      inDouble = true;
      out += c;
      i++;
      continue;
    }
    out += c;
    i++;
  }

  return out;
}

// ─── Rules ────────────────────────────────────────────────────────────────────

interface Rule {
  id: string;
  description: string;
  risk: Exclude<SqlRisk, "safe">;
  /** Tested against the comment-stripped, whitespace-normalized statement (lower-cased). */
  test: (stmt: string) => boolean;
}

/** Normalize a statement: collapse whitespace, lower-case, trim. */
function norm(stmt: string): string {
  return stmt.replace(/\s+/g, " ").trim().toLowerCase();
}

const RULES: Rule[] = [
  {
    id: "DROP_TABLE",
    description: "DROP TABLE removes a table and all its data",
    risk: "irreversible",
    test: (s) => /\bdrop\s+table\b/.test(s),
  },
  {
    id: "DROP_SCHEMA",
    description: "DROP SCHEMA removes a schema and everything in it",
    risk: "irreversible",
    test: (s) => /\bdrop\s+schema\b/.test(s),
  },
  {
    id: "DROP_DATABASE",
    description: "DROP DATABASE destroys a database",
    risk: "irreversible",
    test: (s) => /\bdrop\s+database\b/.test(s),
  },
  {
    id: "TRUNCATE",
    description: "TRUNCATE empties a table",
    risk: "irreversible",
    test: (s) => /\btruncate\b/.test(s),
  },
  {
    id: "DELETE_NO_WHERE",
    description: "DELETE without a WHERE clause removes every row",
    risk: "destructive",
    test: (s) => /\bdelete\s+from\b/.test(s) && !/\bwhere\b/.test(s),
  },
  {
    id: "ALTER_DROP_COLUMN",
    description: "ALTER TABLE ... DROP COLUMN removes a column and its data",
    risk: "irreversible",
    test: (s) => /\balter\s+table\b/.test(s) && /\bdrop\s+column\b/.test(s),
  },
  {
    id: "ALTER_DROP_CONSTRAINT",
    description: "ALTER TABLE ... DROP CONSTRAINT removes a constraint",
    risk: "destructive",
    test: (s) => /\balter\s+table\b/.test(s) && /\bdrop\s+constraint\b/.test(s),
  },
  {
    id: "DROP_POLICY",
    description: "DROP POLICY removes a row-level-security policy (security regression)",
    risk: "destructive",
    test: (s) => /\bdrop\s+policy\b/.test(s),
  },
  {
    id: "DISABLE_RLS",
    description: "DISABLE ROW LEVEL SECURITY weakens table access controls",
    risk: "destructive",
    test: (s) => /\bdisable\s+row\s+level\s+security\b/.test(s),
  },
  {
    id: "DROP_FUNCTION",
    description: "DROP FUNCTION removes a function (CREATE OR REPLACE is the safe form)",
    risk: "destructive",
    // `drop function` but not part of `create or replace function`
    test: (s) => /\bdrop\s+function\b/.test(s),
  },
  {
    id: "DROP_INDEX",
    description: "DROP INDEX removes an index",
    risk: "destructive",
    test: (s) => /\bdrop\s+index\b/.test(s),
  },
];

// ─── Scanning ─────────────────────────────────────────────────────────────────

/** Split stripped SQL into statements on `;`, keeping a line anchor for each. */
function splitStatements(strippedSql: string): Array<{ text: string; line: number }> {
  const out: Array<{ text: string; line: number }> = [];
  let buf = "";
  let startLine = 1;
  let line = 1;
  for (let i = 0; i < strippedSql.length; i++) {
    const c = strippedSql[i]!;
    if (buf.trim() === "") startLine = line; // anchor at first non-blank char's line
    if (c === "\n") line++;
    if (c === ";") {
      if (buf.trim() !== "") out.push({ text: buf, line: startLine });
      buf = "";
      continue;
    }
    buf += c;
  }
  if (buf.trim() !== "") out.push({ text: buf, line: startLine });
  return out;
}

const RISK_ORDER: Record<SqlRisk, number> = { safe: 0, destructive: 1, irreversible: 2 };

/**
 * Scan SQL text (one migration file's contents) for destructive operations.
 * Comments are stripped first.
 */
export function scanSql(sql: string): SqlScanResult {
  const stripped = stripSqlComments(sql);
  const statements = splitStatements(stripped);
  const findings: SqlFinding[] = [];

  for (const stmt of statements) {
    const normalized = norm(stmt.text);
    if (normalized === "") continue;
    for (const rule of RULES) {
      if (rule.test(normalized)) {
        findings.push({
          rule: rule.id,
          description: rule.description,
          risk: rule.risk,
          line: stmt.line,
          snippet: stmt.text.replace(/\s+/g, " ").trim().slice(0, 160),
        });
      }
    }
  }

  let risk: SqlRisk = "safe";
  for (const f of findings) {
    if (RISK_ORDER[f.risk] > RISK_ORDER[risk]) risk = f.risk;
  }

  return { risk, findings, clean: findings.length === 0 };
}

// ─── Hashing ──────────────────────────────────────────────────────────────────

/** SHA-256 of raw migration bytes — drives immutability tracking in the ledger. */
export function hashSql(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}
