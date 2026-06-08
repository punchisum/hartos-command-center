// supabase/functions/persist-cockpit-proposal/index.ts
//
// Phase E (Gap E) — the ONLY write path for "Ask HartOS → a proposal in the
// queue". Server-side: the service role is auto-injected, so the hosted read-only
// Worker never holds a DB/service key — it calls this with a shared CAPABILITY
// token. Propose-only: writes ONLY draft/pending_approval rows and forces
// executable:false. Every row is secret-scanned before write.
//
// DEPLOYED 2026-06-08 to project xbuinrnpfjltimofwrdx via Supabase MCP with
// verify_jwt=false (the shared token is the gate). The service_role needs
// SELECT/INSERT/UPDATE on cockpit_proposals (see migration
// 2026060900000001_cockpit_spine_service_role_grants.sql), else PostgREST 403s.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /tr_(?:dev|prod)_[A-Za-z0-9]{16,}/,
  /\d{6,12}:[A-Za-z0-9_-]{30,}/,
  /\bBearer\s+[A-Za-z0-9._-]{16,}/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];
function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}

const ALLOWED_STATUS = new Set(["draft", "pending_approval"]);
const MAX_PROPOSALS = 20;

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  const token = Deno.env.get("HARTOS_ASK_WRITE_TOKEN");
  if (!token) return json(503, { error: "write token not configured" });
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presented || !timingSafeEqual(presented, token)) return json(401, { error: "unauthorized" });

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(503, { error: "supabase env not available" });

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }
  const incoming = Array.isArray((parsed as { proposals?: unknown[] })?.proposals) ? (parsed as { proposals: unknown[] }).proposals : [];
  if (!incoming.length) return json(400, { error: "no proposals" });
  if (incoming.length > MAX_PROPOSALS) return json(413, { error: "too many proposals" });

  const nowIso = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  const skipped: string[] = [];
  for (const item of incoming) {
    const p = item as Record<string, unknown>;
    if (!p || typeof p !== "object") {
      skipped.push("(non-object)");
      continue;
    }
    const id = typeof p.id === "string" ? p.id : "";
    if (!id) {
      skipped.push("(missing id)");
      continue;
    }
    const status = ALLOWED_STATUS.has(p.status as string) ? (p.status as string) : "draft";
    const payloadIn = p.payload && typeof p.payload === "object" ? (p.payload as Record<string, unknown>) : {};
    const payload = { ...payloadIn, executable: false };
    const row: Record<string, unknown> = {
      id,
      domain: String(p.domain ?? "system"),
      action_type: String(p.action_type ?? "review_plan"),
      title: String(p.title ?? "(untitled)"),
      risk_level: String(p.risk_level ?? "low"),
      status,
      source_intent: p.source_intent == null ? null : String(p.source_intent),
      spec_id: null,
      created_at: typeof p.created_at === "string" && p.created_at ? p.created_at : nowIso,
      updated_at: nowIso,
      expires_at: typeof p.expires_at === "string" ? p.expires_at : null,
      payload,
    };
    if (containsSecret(JSON.stringify(row))) {
      skipped.push(id);
      continue;
    }
    rows.push(row);
  }
  if (!rows.length) return json(200, { persisted: 0, failed: 0, skipped });

  // Upsert via PostgREST as the service role (bypasses the deny-all RLS). The
  // table PK is `id`, so merge-duplicates makes re-asks idempotent.
  const res = await fetch(`${supabaseUrl}/rest/v1/cockpit_proposals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(502, { persisted: 0, failed: rows.length, skipped, error: `db write failed (${res.status})`, detail: detail.slice(0, 300) });
  }
  return json(200, { persisted: rows.length, failed: 0, skipped });
});
