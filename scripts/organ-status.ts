/**
 * scripts/organ-status.ts — print each organ's DERIVED status via the EXACT Worker read path
 * (resolveOrganRegistryView → anon RPCs → deriveOrganStatus). This is cockpit parity: what this
 * prints is what /api/agent-registry serves. Status is derived from SOT evidence, never hardcoded.
 *
 *   node --env-file-if-exists=.env.local dist/scripts/organ-status.js
 */
import { pathToFileURL } from "node:url";
import { resolveOrganRegistryView } from "../src/runtime/cloudflare-live-read-models.js";

export async function organStatus(env: NodeJS.ProcessEnv = process.env): Promise<string[]> {
  const view = await resolveOrganRegistryView(env as unknown as Parameters<typeof resolveOrganRegistryView>[0], {});
  if (!view) {
    return ["organ-status: read-model env not configured (HARTOS_FITNESS_SUPABASE_URL/_READONLY_KEY)"];
  }
  return view.map((v) =>
    `${v.agentId.padEnd(10)} ${v.status.padEnd(11)} run@${v.lastRunAt ?? "—"} ref=${v.lastOutputRef ?? "—"}`.slice(0, 180),
  );
}

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  organStatus()
    .then((lines) => {
      console.log("\nHartOS organ status — DERIVED from SOT (worker parity)\n");
      for (const l of lines) console.log(`  ${l}`);
      console.log("");
    })
    .catch((e) => {
      console.error(`organ-status failed: ${e instanceof Error ? e.message : String(e)}`);
      process.exit(1);
    });
}
