import { getEnv } from "../src/runtime/env.js";

const env = getEnv();
if (!env.CLOUDFLARE_WORKER_URL) {
  console.log("cloudflare: not configured");
  process.exit(0);
}

const url = env.CLOUDFLARE_WORKER_URL.replace(/\/$/, "");
const response = await fetch(`${url}/health`);
console.log(`cloudflare health: ${response.ok ? "ok" : `error ${response.status}`}`);
