// supabase/functions/relay-ask/index.ts
//
// P-B1 — Ask-relay Edge Function.
//
// Cloned from persist-cockpit-proposal and adapted for the async ask-relay.
// Self-authenticates via HARTOS_ASK_WRITE_TOKEN (same token as proposal writes;
// note: can be split to a dedicated HARTOS_ASK_RELAY_TOKEN later if independent
// rotation is desired — see design doc §4 decision 3).
//
// The service-role key is auto-injected by Supabase (SUPABASE_SERVICE_ROLE_KEY
// env var on the Edge runtime), so the Worker never holds a DB key.
//
// Two operations (keyed by request body shape):
//   { insert: { id, redacted_request, context? } }
//     → INSERT a pending ask_request row (secret-scan request+context first).
//     → Returns: { ok: true, id }
//
//   { read: { id } }
//     → Read a single row's status/answer/provider/error via the table directly
//       (service-role can bypass RLS). The Worker will use the anon-key
//       hartos_get_ask_request RPC instead, but this write-path function can also
//       serve the daemon if needed.
//     → Returns: { ok: true, row: { id, status, answer, provider, error, answered_at, expires_at } | null }
//
// DEPLOYED to project xbuinrnpfjltimofwrdx (same project as cockpit_proposals).
// DISARMED: the Worker does not call this until HARTOS_ASK_VIA_RELAY=true is set.
//
// Security notes:
//   - Bearer token check uses timing-safe comparison (same as persist-cockpit-proposal).
//   - Secret-scan (SECRET_PATTERNS) runs on redacted_request + serialized context before INSERT.
//   - No answer-write path here: the daemon writes answers via direct pg (HARTOS_SUPABASE_DB_URL).
//   - MAX_CONTEXT_BYTES enforced to prevent oversized payloads.

const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{16,}/,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
  /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/,
  /gh[pousr]_[A-Za-z0-9_]{20,}/,
  /xox[baprs]-[A-Za-z0-9-]{10,}/,
  /tr_(?:dev|prod)_[A-Za-z0-9]{16,}/,
  /api\.telegram\.org\/bot[A-Za-z0-9:_-]+/i,
  /\d{6,12}:[A-Za-z0-9_-]{30,}/,
  /\bBearer\s+[A-Za-z0-9._\-]{16,}/i,
  /\b[a-z][a-z0-9+.\-]*:\/\/[^\s/@]+:[^\s/@]+@\S+/i,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
];

function containsSecret(text: string): boolean {
  return SECRET_PATTERNS.some((p) => p.test(text));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Max context payload to prevent oversized relay rows. */
const MAX_CONTEXT_BYTES = 65_536; // 64 KB

/** INSERT a pending ask_request row. Returns { ok, id } on success. */
async function handleInsert(
  insert: { id?: unknown; redacted_request?: unknown; context?: unknown },
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const id = typeof insert.id === "string" ? insert.id.trim() : "";
  const redactedRequest = typeof insert.redacted_request === "string" ? insert.redacted_request : "";

  if (!id) return json(400, { ok: false, error: "id is required" });
  if (!redactedRequest) return json(400, { ok: false, error: "redacted_request is required" });

  // Secret-scan the request text.
  if (containsSecret(redactedRequest)) {
    return json(400, { ok: false, error: "secret detected in redacted_request — request rejected" });
  }

  // Validate and secret-scan the context payload.
  let contextJson: string | null = null;
  if (insert.context !== undefined && insert.context !== null) {
    try {
      contextJson = JSON.stringify(insert.context);
    } catch {
      return json(400, { ok: false, error: "context is not JSON-serializable" });
    }
    if (contextJson.length > MAX_CONTEXT_BYTES) {
      return json(413, { ok: false, error: `context too large (${contextJson.length} > ${MAX_CONTEXT_BYTES} bytes)` });
    }
    if (containsSecret(contextJson)) {
      return json(400, { ok: false, error: "secret detected in context — request rejected" });
    }
  }

  const nowIso = new Date().toISOString();
  // TTL: 2 minutes from now (mirrors the schema default).
  const expiresAt = new Date(Date.now() + 2 * 60 * 1000).toISOString();

  const row: Record<string, unknown> = {
    id,
    status: "pending",
    redacted_request: redactedRequest,
    context: contextJson !== null ? JSON.parse(contextJson) : null,
    created_at: nowIso,
    expires_at: expiresAt,
  };

  const headers = {
    "content-type": "application/json",
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    // ON CONFLICT DO NOTHING: if the Worker retries the insert (network hiccup),
    // the existing row is not overwritten. The Worker then polls and gets the result.
    prefer: "resolution=ignore-duplicates,return=minimal",
  };

  const res = await fetch(`${supabaseUrl}/rest/v1/ask_requests`, {
    method: "POST",
    headers,
    body: JSON.stringify(row),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(502, {
      ok: false,
      error: `db insert failed (${res.status})`,
      detail: detail.slice(0, 200),
    });
  }

  await res.text().catch(() => ""); // drain body
  return json(200, { ok: true, id });
}

/** Read a single ask_request row by id (service-role bypasses RLS). */
async function handleRead(
  read: { id?: unknown },
  supabaseUrl: string,
  serviceKey: string,
): Promise<Response> {
  const id = typeof read.id === "string" ? read.id.trim() : "";
  if (!id) return json(400, { ok: false, error: "id is required" });

  const headers = {
    apikey: serviceKey,
    authorization: `Bearer ${serviceKey}`,
    accept: "application/json",
  };

  const res = await fetch(
    `${supabaseUrl}/rest/v1/ask_requests?id=eq.${encodeURIComponent(id)}&select=id,status,answer,provider,error,answered_at,expires_at`,
    { headers },
  );

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    return json(502, { ok: false, error: `db read failed (${res.status})`, detail: detail.slice(0, 200) });
  }

  const rows = (await res.json().catch(() => [])) as unknown[];
  const row = Array.isArray(rows) ? (rows[0] ?? null) : null;
  return json(200, { ok: true, row });
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== "POST") return json(405, { error: "method not allowed" });

  // Auth: Bearer token timing-safe check. Uses HARTOS_ASK_WRITE_TOKEN (shared with
  // persist-cockpit-proposal); can be swapped to HARTOS_ASK_RELAY_TOKEN when independent
  // rotation is desired (Hart's gate per design doc §4 decision 3).
  const token = Deno.env.get("HARTOS_ASK_WRITE_TOKEN");
  if (!token) return json(503, { error: "relay write token not configured" });
  const auth = req.headers.get("authorization") ?? "";
  const presented = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!presented || !timingSafeEqual(presented, token)) {
    return json(401, { error: "unauthorized" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) return json(503, { error: "supabase env not available" });

  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    return json(400, { error: "invalid json" });
  }

  const body = parsed as Record<string, unknown>;

  // INSERT path.
  if (body["insert"] && typeof body["insert"] === "object") {
    return await handleInsert(body["insert"] as { id?: unknown; redacted_request?: unknown; context?: unknown }, supabaseUrl, serviceKey);
  }

  // READ path (service-role convenience; the Worker uses the anon RPC instead).
  if (body["read"] && typeof body["read"] === "object") {
    return await handleRead(body["read"] as { id?: unknown }, supabaseUrl, serviceKey);
  }

  return json(400, { error: "expected { insert: {...} } or { read: { id } }" });
});
