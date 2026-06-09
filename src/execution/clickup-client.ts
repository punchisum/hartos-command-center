/**
 * src/execution/clickup-client.ts — §14: the injected, token-bearing ClickUp client + stores.
 *
 * This is the LIVE seam the T3 adapters' docstrings anticipate: a minimal ClickUp REST client
 * (fetch-based, Node/Edge-safe) plus the two store builders that map adapter store methods onto
 * it. The ClickUp token is the secret — read from `CLICKUP_API_TOKEN`, sent only in the
 * Authorization header, and NEVER logged. The whole client lives on the Node execution host; it
 * never enters the read-only Worker bundle.
 *
 * The `ClickUpRestClient` is an interface, so tests inject a fake (no network) and the exact
 * HTTP calls — paths, bodies, the embedded idempotency marker — are pinned without a live token.
 * `createClickUpClient` returns null when the token is absent, so the executor degrades to
 * "not configured" rather than throwing.
 */

import type { ClickUpCommentStore, ClickUpCard } from "./adapters/clickup-comment.js";
import type { ClickUpMoveStore, ClickUpCardStatus } from "./adapters/clickup-move-status.js";

/** The env var holding the ClickUp personal/API token (the secret; never logged). */
export const CLICKUP_TOKEN_ENV = "CLICKUP_API_TOKEN";

/** Default ClickUp REST base — overridable via `CLICKUP_API_BASE` (e.g. for a proxy in tests). */
export const DEFAULT_CLICKUP_API_BASE = "https://api.clickup.com/api/v2";

/** Minimal ClickUp surface the two stores need. Tests inject a fake; prod uses the REST client. */
export interface ClickUpRestClient {
  /** GET a task; null when it does not exist (404). Other non-OK responses throw. */
  getTask(taskId: string): Promise<{ id: string; name: string; status: string } | null>;
  /** List a task's comments (id + text), newest-or-oldest order is irrelevant to the marker scan. */
  listComments(taskId: string): Promise<Array<{ id: string; text: string }>>;
  /** Create one comment; returns its id. */
  createComment(taskId: string, text: string): Promise<{ id: string }>;
  /** Set a task's status. */
  setStatus(taskId: string, status: string): Promise<void>;
}

/** The hidden marker embedded in a HartOS-posted comment so re-runs are idempotent. */
export function clickupIdempotencyMarker(idempotencyKey: string): string {
  return `<!-- hartos-idem:${idempotencyKey} -->`;
}

/** Build the comment-store over any ClickUpRestClient (the seam tests exercise). */
export function makeClickUpCommentStore(client: ClickUpRestClient): ClickUpCommentStore {
  return {
    async getCard(cardId: string): Promise<ClickUpCard | null> {
      const t = await client.getTask(cardId);
      return t ? { id: t.id, name: t.name } : null;
    },
    async findCommentByIdempotencyKey(cardId: string, idempotencyKey: string): Promise<{ id: string } | null> {
      const marker = clickupIdempotencyMarker(idempotencyKey);
      const comments = await client.listComments(cardId);
      const hit = comments.find((c) => c.text.includes(marker));
      return hit ? { id: hit.id } : null;
    },
    async countComments(cardId: string): Promise<number> {
      return (await client.listComments(cardId)).length;
    },
    async addComment(cardId: string, text: string, idempotencyKey: string): Promise<{ id: string }> {
      // Embed the marker so a future run recognises this exact comment and never duplicates it.
      const body = `${text}\n\n${clickupIdempotencyMarker(idempotencyKey)}`;
      return client.createComment(cardId, body);
    },
  };
}

/** Build the move-store over any ClickUpRestClient (the seam tests exercise). */
export function makeClickUpMoveStore(client: ClickUpRestClient): ClickUpMoveStore {
  return {
    async getCard(cardId: string): Promise<ClickUpCardStatus | null> {
      const t = await client.getTask(cardId);
      return t ? { id: t.id, name: t.name, status: t.status } : null;
    },
    async moveCard(cardId: string, toStatus: string): Promise<void> {
      await client.setStatus(cardId, toStatus);
    },
  };
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>;

/**
 * The real ClickUp REST client over fetch. The token goes ONLY into the Authorization header
 * and is never logged. `getTask` maps a 404 to null (so "not found" is data, not an error);
 * any other non-OK response throws with the status (never the token).
 */
export function realClickUpClient(token: string, base = DEFAULT_CLICKUP_API_BASE, fetchImpl?: FetchLike): ClickUpRestClient {
  const doFetch = fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
  const headers = { authorization: token, "content-type": "application/json" };

  async function get(path: string): Promise<{ ok: boolean; status: number; body: unknown }> {
    const res = await doFetch(`${base}${path}`, { method: "GET", headers });
    return { ok: res.ok, status: res.status, body: res.ok ? await res.json() : null };
  }

  return {
    async getTask(taskId: string) {
      const r = await get(`/task/${encodeURIComponent(taskId)}`);
      if (r.status === 404) return null;
      if (!r.ok) throw new Error(`ClickUp getTask failed (${r.status})`);
      const t = r.body as { id: string; name: string; status?: { status?: string } };
      return { id: t.id, name: t.name, status: t.status?.status ?? "" };
    },
    async listComments(taskId: string) {
      const r = await get(`/task/${encodeURIComponent(taskId)}/comment`);
      if (!r.ok) throw new Error(`ClickUp listComments failed (${r.status})`);
      const body = r.body as { comments?: Array<{ id: string; comment_text?: string }> };
      return (body.comments ?? []).map((c) => ({ id: c.id, text: c.comment_text ?? "" }));
    },
    async createComment(taskId: string, text: string) {
      const res = await doFetch(`${base}/task/${encodeURIComponent(taskId)}/comment`, {
        method: "POST",
        headers,
        body: JSON.stringify({ comment_text: text }),
      });
      if (!res.ok) throw new Error(`ClickUp createComment failed (${res.status})`);
      const body = (await res.json()) as { id?: string; comment?: { id?: string } };
      const id = body.id ?? body.comment?.id;
      if (!id) throw new Error("ClickUp createComment returned no comment id");
      return { id: String(id) };
    },
    async setStatus(taskId: string, status: string) {
      const res = await doFetch(`${base}/task/${encodeURIComponent(taskId)}`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ status }),
      });
      if (!res.ok) throw new Error(`ClickUp setStatus failed (${res.status})`);
    },
  };
}

export interface ClickUpStores {
  commentStore: ClickUpCommentStore;
  moveStore: ClickUpMoveStore;
}

/**
 * Build the token-bearing live ClickUp stores from env, or null when the token is absent.
 * The connection token itself is the secret; it is never logged. Callers degrade to
 * "ClickUp not configured" rather than throwing when this returns null.
 */
export function createClickUpClient(env: Record<string, string | undefined> = process.env, fetchImpl?: FetchLike): ClickUpStores | null {
  const token = env[CLICKUP_TOKEN_ENV];
  if (!token || token.trim().length === 0) return null;
  const base = env.CLICKUP_API_BASE && env.CLICKUP_API_BASE.trim().length > 0 ? env.CLICKUP_API_BASE : DEFAULT_CLICKUP_API_BASE;
  const client = realClickUpClient(token, base, fetchImpl);
  return { commentStore: makeClickUpCommentStore(client), moveStore: makeClickUpMoveStore(client) };
}
