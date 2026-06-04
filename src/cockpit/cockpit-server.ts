/**
 * src/cockpit/cockpit-server.ts
 *
 * A dependency-free local HTTP server (node:http) for the cockpit. Bound to
 * localhost only. Routes:
 *   GET  /                          → cockpit HTML
 *   GET  /api/state                 → cockpit state JSON
 *   GET  /api/reports               → local report list JSON
 *   GET  /api/threads               → persisted thread list JSON
 *   POST /api/orchestrator/message  → run LOCAL Orchestrator, return response
 *
 * POST may only call local Orchestrator logic. No provider/Supabase/pack
 * mutation, no deploys, no network calls. Input is validated; empty/oversized/
 * secret-looking requests are rejected with safe error JSON.
 *
 * The route logic is exposed as `routeRequest` so it can be tested without
 * opening any sockets.
 */

import http from "node:http";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { buildCockpitState } from "./cockpit-read-model.js";
import { renderCockpitHtml } from "./cockpit-renderer.js";
import { askOrchestrator, makeMessageInput, CockpitRequestError } from "./cockpit-orchestrator-bridge.js";
import { validateRequest } from "./cockpit-state.js";

export interface RouteResult {
  status: number;
  contentType: string;
  body: string;
}

export interface RouteContext {
  cwd: string;
}

function json(status: number, data: unknown): RouteResult {
  return { status, contentType: "application/json", body: JSON.stringify(data, null, 2) };
}

async function listThreads(cwd: string): Promise<string[]> {
  const dir = path.join(cwd, "cockpit-threads");
  if (!existsSync(dir)) return [];
  try {
    return (await readdir(dir)).filter((f) => f.startsWith("thread-") && f.endsWith(".json")).sort().reverse();
  } catch {
    return [];
  }
}

/**
 * Core router — pure with respect to sockets. Tests call this directly.
 * `body` is the raw request body for POST requests (JSON string), else null.
 */
export async function routeRequest(
  method: string,
  urlPath: string,
  body: string | null,
  ctx: RouteContext
): Promise<RouteResult> {
  const cwd = ctx.cwd;

  if (method === "GET" && (urlPath === "/" || urlPath === "/index.html")) {
    const state = await buildCockpitState({ cwd });
    return { status: 200, contentType: "text/html; charset=utf-8", body: renderCockpitHtml(state, { serverMode: true }) };
  }

  if (method === "GET" && urlPath === "/api/state") {
    const state = await buildCockpitState({ cwd });
    return json(200, state);
  }

  if (method === "GET" && urlPath === "/api/reports") {
    const state = await buildCockpitState({ cwd });
    return json(200, { reports: state.reports });
  }

  if (method === "GET" && urlPath === "/api/threads") {
    return json(200, { threads: await listThreads(cwd) });
  }

  if (method === "POST" && urlPath === "/api/orchestrator/message") {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body && body.length > 0 ? body : "{}");
    } catch {
      return json(400, { error: "Invalid JSON body." });
    }
    const request = (parsed as { request?: unknown }).request;
    const validation = validateRequest(request);
    if (!validation.ok || !validation.value) {
      return json(400, { error: validation.error ?? "Invalid request." });
    }
    const threadId = (parsed as { threadId?: unknown }).threadId;
    try {
      const response = await askOrchestrator(
        makeMessageInput(validation.value, typeof threadId === "string" ? threadId : undefined),
        { cwd }
      );
      return json(200, response);
    } catch (err) {
      if (err instanceof CockpitRequestError) return json(400, { error: err.message });
      return json(500, { error: "Local Orchestrator error." });
    }
  }

  return json(404, { error: "Not found." });
}

async function readBody(req: http.IncomingMessage, maxBytes = 64 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large."));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

export interface CockpitServerOptions {
  cwd?: string;
  port?: number;
}

/** Create (but do not start) the local cockpit HTTP server. */
export function createCockpitServer(options: CockpitServerOptions = {}): http.Server {
  const cwd = options.cwd ?? process.cwd();
  return http.createServer(async (req, res) => {
    try {
      const urlPath = (req.url ?? "/").split("?")[0] ?? "/";
      const method = req.method ?? "GET";
      let body: string | null = null;
      if (method === "POST") {
        try {
          body = await readBody(req);
        } catch {
          const r = json(413, { error: "Request body too large." });
          res.writeHead(r.status, { "content-type": r.contentType });
          res.end(r.body);
          return;
        }
      }
      const result = await routeRequest(method, urlPath, body, { cwd });
      res.writeHead(result.status, { "content-type": result.contentType });
      res.end(result.body);
    } catch {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: "Internal cockpit error." }));
    }
  });
}

/** Start the server on localhost. Resolves with the actual bound port. */
export function startCockpitServer(options: CockpitServerOptions = {}): Promise<{ server: http.Server; port: number }> {
  const server = createCockpitServer(options);
  const requestedPort = options.port ?? 3000;
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(requestedPort, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : requestedPort;
      resolve({ server, port });
    });
  });
}
