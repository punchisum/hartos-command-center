/**
 * scripts/cockpit-web.ts
 *
 * cockpit:web — start the local cockpit HTTP server (localhost only).
 *
 * Flags:
 *   --port=3100   choose the port (default 3000)
 *   --once        bind, print the URL, then immediately close (smoke-safe)
 *   --dry-run     build the cockpit state + HTML WITHOUT binding a port
 *
 * Local only. No provider/Supabase/pack mutation, no deploys, no network.
 *
 * Usage:
 *   npm run cockpit:web
 *   npm run cockpit:web -- --port=3100
 *   npm run cockpit:web -- --once
 *   npm run cockpit:web -- --dry-run
 */

import { buildCockpitSnapshot } from "../src/cockpit/cockpit.js";
import { startCockpitServer } from "../src/cockpit/cockpit-server.js";

function parsePort(argv: string[]): number | undefined {
  const arg = argv.find((a) => a.startsWith("--port="));
  if (!arg) return undefined;
  const n = Number.parseInt(arg.slice("--port=".length), 10);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

const argv = process.argv.slice(2);
const cwd = process.cwd();
const dryRun = argv.includes("--dry-run");
const once = argv.includes("--once");
const requestedPort = parsePort(argv);

if (dryRun) {
  // No socket is opened. Just prove the state + HTML build deterministically.
  const { state, html } = await buildCockpitSnapshot({ cwd });
  console.log("\nHartOS Cockpit (dry-run): test-agent");
  console.log(`Cards: ${state.summary.cardCount} | Reports: ${state.summary.reportCount} | HTML bytes: ${html.length}`);
  console.log("Dry run complete — no server was started.");
  console.log("");
  process.exit(0);
}

// --once binds an ephemeral port unless one was requested, so smoke runs never
// collide with a port already in use.
const port = once ? requestedPort ?? 0 : requestedPort ?? 3000;
const { server, port: boundPort } = await startCockpitServer({ cwd, port });

console.log("\nHartOS Local Visible Cockpit: test-agent");
console.log(`Listening on http://localhost:${boundPort}`);
console.log("Local mode — recommendations only, no execution, no network.");

if (once) {
  console.log("--once: server started successfully; closing.");
  server.close(() => process.exit(0));
} else {
  console.log("Press Ctrl+C to stop.");
}
