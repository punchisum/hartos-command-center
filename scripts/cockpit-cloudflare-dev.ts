/**
 * scripts/cockpit-cloudflare-dev.ts
 *
 * dev:cloudflare — local development helper for the hosted cockpit Worker.
 *
 *   npm run dev:cloudflare -- --dry-run   → run MOCKED requests through the
 *                                           Worker handler and print results.
 *                                           No server, no network, no deploy.
 *   npm run dev:cloudflare                → print the exact `wrangler dev`
 *                                           command + setup notes. It does NOT
 *                                           start wrangler for you (deliberate;
 *                                           keeps this script dependency-free
 *                                           and safe in CI).
 */

import { handleCockpitRequest, createCockpitWorkerContext, SUPPORTED_ROUTES } from "../src/runtime/cloudflare-cockpit-worker.js";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const base = "https://cockpit.local";
const cwd = process.cwd();

if (!dryRun) {
  console.log("\nHartOS Hosted Cockpit — dev:cloudflare\n");
  console.log("This command does NOT start a server. To run a local Worker dev server:");
  console.log("  1. Copy wrangler.cockpit.toml.example → wrangler.cockpit.toml (gitignored).");
  console.log("  2. Put your access token + read-only Supabase keys in .dev.vars (gitignored):");
  console.log("       HARTOS_COCKPIT_ACCESS_TOKEN=...");
  console.log("       HARTOS_COCKPIT_DEV_AUTH_BYPASS=true   # optional: skip auth locally");
  console.log("  3. npm run build");
  console.log("  4. npx wrangler dev --config wrangler.cockpit.toml");
  console.log("\nOr exercise the handler without a server:");
  console.log("  npm run dev:cloudflare -- --dry-run\n");
  console.log(`Routes served: ${SUPPORTED_ROUTES.join(", ")}\n`);
  process.exit(0);
}

const ctx = await createCockpitWorkerContext({ cwd });
const probes: { label: string; request: Request; expect: number }[] = [
  { label: "GET /", request: new Request(`${base}/`), expect: 200 },
  { label: "GET /health", request: new Request(`${base}/health`), expect: 200 },
  { label: "GET /api/state", request: new Request(`${base}/api/state`), expect: 200 },
  { label: "GET /api/freshness", request: new Request(`${base}/api/freshness`), expect: 200 },
  { label: "GET /api/read-models/status", request: new Request(`${base}/api/read-models/status`), expect: 200 },
  { label: "GET /api/proposals", request: new Request(`${base}/api/proposals`), expect: 200 },
  {
    label: "POST /api/ask (daily brief)",
    request: new Request(`${base}/api/ask`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ request: "Daily command brief" }) }),
    expect: 200,
  },
  { label: "DELETE / (rejected)", request: new Request(`${base}/`, { method: "DELETE" }), expect: 405 },
];

console.log("\nHartOS Hosted Cockpit — dev dry-run (mocked, no network)\n");
let ok = true;
for (const probe of probes) {
  const res = await handleCockpitRequest(probe.request, {}, ctx);
  const pass = res.status === probe.expect;
  if (!pass) ok = false;
  console.log(`  ${pass ? "ok  " : "FAIL"} ${probe.label} → ${res.status} (expected ${probe.expect})`);
}
console.log("");
if (!ok) {
  console.log("Dry-run had failures.\n");
  process.exit(1);
}
console.log("Dry-run passed — handler responds read-only with no server, no network, no deploy.\n");
