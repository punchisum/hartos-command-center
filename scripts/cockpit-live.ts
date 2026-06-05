/**
 * scripts/cockpit-live.ts
 *
 * cockpit:live — run the HOSTED cockpit Worker handler locally, end-to-end, with
 * the LIVE 18E control surface backed by local data. This exercises exactly the
 * code path the Cloudflare Worker uses (handleCockpitRequest + the control-surface
 * provider), so you can open the hosted surface in a browser and watch it refresh.
 *
 *   npm run cockpit:live            → start a local server (default :8788)
 *   npm run cockpit:live -- --smoke → run probes through the handler, no server
 *
 * Read-only: no provider mutation, no deploy, no secrets in any response. Auth is
 * bypassed locally (dev only) so the surface is directly viewable.
 */

import http from "node:http";
import { buildControlSurfaceState } from "../src/cockpit/control-surface/index.js";
import { handleCockpitRequest } from "../src/runtime/cloudflare-cockpit-worker.js";
import type { CockpitWorkerContext } from "../src/runtime/cloudflare-cockpit-types.js";
import { resolveHostedControlSurface } from "../src/runtime/cloudflare-control-surface.js";

const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const port = Number(process.env.PORT ?? 8788);
const cwd = process.cwd();

// Local env: dev auth bypass (non-prod only). Inherit any HARTOS_*/read-model env
// so that if you have read-only Supabase creds set, the hosted adapters go live.
const env: Record<string, string | undefined> = {
  ...process.env,
  APP_ENV: process.env.APP_ENV ?? "development",
  HARTOS_COCKPIT_DEV_AUTH_BYPASS: "true",
};

/**
 * Control-surface provider. If read-model env is configured we use the SAME live
 * resolver the Worker uses; otherwise we fall back to the local disk-backed
 * surface so the dev view is populated (Tax/Factory from local reports).
 */
const ctx: CockpitWorkerContext = {
  runtimeMode: "hosted-dev",
  controlSurfaceProvider: async () => {
    const now = new Date().toISOString();
    const hosted = await resolveHostedControlSurface(env, { now });
    // If hosted has live data (any non-unknown agent), use it; else use local disk.
    const live = hosted.bundles.some((b) => b.verdict !== "UNKNOWN");
    return live ? hosted : buildControlSurfaceState({ cwd, now });
  },
};

const PROBES: Array<{ label: string; path: string; method?: string; expect: number }> = [
  { label: "GET /control (HTML)", path: "/control", expect: 200 },
  { label: "GET /api/control-surface (JSON)", path: "/api/control-surface", expect: 200 },
  { label: "GET /health", path: "/health", expect: 200 },
  { label: "DELETE /control (rejected)", path: "/control", method: "DELETE", expect: 405 },
];

async function runSmoke(): Promise<void> {
  console.log("\nHartOS Hosted Cockpit — cockpit:live smoke (handler only, no server)\n");
  let ok = true;
  for (const p of PROBES) {
    const res = await handleCockpitRequest(new Request(`https://cockpit.local${p.path}`, { method: p.method ?? "GET" }), env, ctx);
    const pass = res.status === p.expect;
    if (!pass) ok = false;
    let extra = "";
    if (p.path === "/api/control-surface" && res.status === 200) {
      const body = await res.clone().text();
      const hasSecret = /sk-[A-Za-z0-9_-]{16,}|eyJ[A-Za-z0-9_-]{10,}\./.test(body);
      const data = JSON.parse(body) as { systemVerdict?: string; agents?: unknown[] };
      extra = ` [verdict=${data.systemVerdict}, agents=${data.agents?.length ?? 0}, secrets=${hasSecret ? "LEAK!" : "none"}]`;
      if (hasSecret) ok = false;
    }
    console.log(`  ${pass ? "ok  " : "FAIL"} ${p.label} → ${res.status} (expect ${p.expect})${extra}`);
  }
  console.log("");
  if (!ok) {
    console.log("Smoke had failures.\n");
    process.exitCode = 1;
    return;
  }
  console.log("Smoke passed — hosted control surface serves read-only, secret-free.\n");
}

async function readBody(req: http.IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

function startServer(): void {
  const server = http.createServer(async (req, res) => {
    try {
      const url = `http://localhost:${port}${req.url ?? "/"}`;
      const method = (req.method ?? "GET").toUpperCase();
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === "string") headers.set(k, v);
        else if (Array.isArray(v)) headers.set(k, v.join(", "));
      }
      const init: RequestInit = { method, headers };
      if (method === "POST") init.body = await readBody(req);
      const response = await handleCockpitRequest(new Request(url, init), env, ctx);
      res.statusCode = response.status;
      response.headers.forEach((value, key) => res.setHeader(key, value));
      const buf = Buffer.from(await response.arrayBuffer());
      res.end(buf);
    } catch (err) {
      res.statusCode = 500;
      res.end(`error: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
  server.listen(port, () => {
    console.log(`\nHartOS Hosted Cockpit (live, local) on http://localhost:${port}`);
    console.log(`  Control surface : http://localhost:${port}/control`);
    console.log(`  JSON API        : http://localhost:${port}/api/control-surface`);
    console.log(`  Read-only · auth bypassed (dev) · no mutation · Ctrl+C to stop\n`);
  });
}

if (smoke) {
  await runSmoke();
} else {
  startServer();
}
