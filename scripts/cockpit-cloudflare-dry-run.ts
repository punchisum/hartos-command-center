/**
 * scripts/cockpit-cloudflare-dry-run.ts
 *
 * cockpit:cloudflare:dry-run — build the cockpit snapshot context locally and
 * run MOCKED requests against the Worker handler to confirm HTML/API responses.
 * No server, no network, no deploy, no mutation. Writes a report.
 *
 * Usage:
 *   npm run cockpit:cloudflare:dry-run
 */

import path from "node:path";
import {
  handleCockpitRequest,
  createCockpitWorkerContext,
} from "../src/runtime/cloudflare-cockpit-worker.js";
import {
  buildDeployPlan,
  writeCloudflareCockpitReport,
  DEFAULT_CLOUDFLARE_REPORTS_DIR,
} from "../src/runtime/cloudflare-deploy-bridge.js";

const cwd = process.cwd();
const env = process.env as Record<string, string | undefined>;
const base = "https://cockpit.local";

const ctx = await createCockpitWorkerContext({ cwd });

interface Probe {
  label: string;
  request: Request;
}
const probes: Probe[] = [
  { label: "GET /", request: new Request(`${base}/`) },
  { label: "GET /health", request: new Request(`${base}/health`) },
  { label: "GET /api/state", request: new Request(`${base}/api/state`) },
  { label: "GET /api/debug/status", request: new Request(`${base}/api/debug/status`) },
  {
    label: "POST /api/orchestrator/message",
    request: new Request(`${base}/api/orchestrator/message`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ request: "What is the status of my Ops Agent and Fitness Agent?" }),
    }),
  },
  { label: "DELETE / (must be rejected)", request: new Request(`${base}/`, { method: "DELETE" }) },
];

console.log("\nHartOS Cloudflare Cockpit — Dry Run: test-agent");
let allOk = true;
for (const probe of probes) {
  const res = await handleCockpitRequest(probe.request, env, ctx);
  const ctype = res.headers.get("content-type") ?? "";
  const expectReject = probe.label.startsWith("DELETE");
  const ok = expectReject ? res.status === 405 : res.status === 200;
  if (!ok) allOk = false;
  console.log(`  ${probe.label} → ${res.status} ${ctype.split(";")[0]}`);
}

const plan = buildDeployPlan(env, "dry-run");
const { mdPath, jsonPath } = await writeCloudflareCockpitReport(
  path.join(cwd, DEFAULT_CLOUDFLARE_REPORTS_DIR),
  plan
);

console.log(`\nMocked probes ${allOk ? "all passed" : "had failures"} — no server started, no network.`);
console.log(`Routes: ${plan.routes.join(", ")}`);
console.log(`Action execution: ${plan.actionExecution} | Mutation endpoints: ${plan.mutationEndpoints}`);
console.log(`Report: ${path.relative(cwd, mdPath)}`);
console.log(`Sidecar: ${path.relative(cwd, jsonPath)}`);
console.log("");
if (!allOk) process.exit(1);
