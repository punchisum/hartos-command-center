// supabase/functions/persist-cockpit-proposal/index.ts
//
// The ONLY write path for the cockpit proposal spine. Server-side: the service role
// is auto-injected, so the hosted read-only Worker never holds a DB/service key — it
// calls this with a shared CAPABILITY token. Two operations, both status-safe:
//
//   { proposals: [...] }            — Phase E: persist propose-only DRAFT/pending rows.
//                                     Uses ignore-duplicates (Phase 2.2 #4 fix): a re-ask
//                                     NEVER overwrites an existing row, so it can never
//                                     downgrade a proposal Hart already approved/rejected.
//   { transition: { id, action } }  — Phase 2.4: approve/reject. CONDITIONAL PATCH that
//                                     only matches an eligible status (never downgrades),
//                                     then appends an immutable audit row (Phase 2.3).
//
// Forces executable:false on persist; every row is secret-scanned before write.
// DEPLOYED to project xbuinrnpfjltimofwrdx (cockpit_proposals + cockpit_proposal_audit).

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

// Phase 2.4 — the only cockpit/Worker-settable transitions. Each names its target and
// the EXACT set of statuses it may act on, so the conditional write never downgrades.
const TRANSITIONS: Record<string, { to: string; fromFilter: string }> = {
  approve: { to: "simulated_approved", fromFilter: "status=eq.pending_approval" },
  reject: { to: "rejected", fromFilter: "status=in.(draft,pending_approval)" },
};

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** Phase 2.4 — a conditional, status-safe approve/reject + an append-only audit row. */
async function handleTransition(
  transition: { id?: unknown; action?: unknown },
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const id = typeof transition.id === "string" ? transition.id : "";
  const action = typeof transition.action === "string" ? transition.action : "";
  const t = TRANSITIONS[action];
  if (!id || !t) return json(400, { ok: false, error: "invalid transition (need id + action approve|reject)" });

  const nowIso = new Date().toISOString();
  const headers = {
    "content-type": "application/json",
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
  };
  // Conditional PATCH: only rows whose status is still eligible match. An already
  // approved/rejected/executed row matches NOTHING — so this can never downgrade.
  const patch = await fetch(
    `${supabaseUrl}/rest/v1/cockpit_proposals?id=eq.${encodeURIComponent(id)}&${t.fromFilter}`,
    {
      method: "PATCH",
      headers: { ...headers, prefer: "return=representation" },
      body: JSON.stringify({ status: t.to, updated_at: nowIso }),
    },
  );
  if (!patch.ok) {
    const detail = await patch.text().catch(() => "");
    return json(502, { ok: false, error: `transition write failed (${patch.status})`, detail: detail.slice(0, 200) });
  }
  const updated = (await patch.json().catch(() => [])) as unknown[];
  const changed = Array.isArray(updated) && updated.length > 0;

  if (changed) {
    // Append-only audit (Phase 2.3). Best-effort — never blocks the transition result.
    await fetch(`${supabaseUrl}/rest/v1/cockpit_proposal_audit`, {
      method: "POST",
      headers: { ...headers, prefer: "return=minimal" },
      body: JSON.stringify({ proposal_id: id, event: action, to_status: t.to, at: nowIso }),
    }).catch(() => {});
  }
  return json(200, { ok: changed, status: changed ? t.to : null });
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

  // Phase 2.4 — approval transition takes priority over persist.
  const transition = (parsed as { transition?: { id?: unknown; action?: unknown } })?.transition;
  if (transition && typeof transition === "object") {
    return await handleTransition(transition, supabaseUrl, serviceKey);
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

  // Phase 2.2 #4 — ignore-duplicates (INSERT ... ON CONFLICT DO NOTHING). A re-ask of an
  // existing id is a no-op, so a persist can NEVER downgrade an approved/rejected row.
  const res = await fetch(`${supabaseUrl}/rest/v1/cockpit_proposals`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      prefer: "resolution=ignore-duplicates,return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(502, { persisted: 0, failed: rows.length, skipped, error: `db write failed (${res.status})`, detail: detail.slice(0, 300) });
  }
  return json(200, { persisted: rows.length, failed: 0, skipped });
});
