/**
 * src/scripts/render-control-surface.ts
 *
 * Phase 18E â€” local preview. Assembles the cockpit control surface from real
 * on-disk surfaces (runtime-provision reports, proposal queue, read-models) and
 * writes a self-contained HTML file you can open in a browser. Read-only: no
 * network mutation, no secrets â€” exactly like the rest of the cockpit.
 *
 *   npm run cockpit:control          # writes cockpit-reports/control-surface.html
 */

import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { buildControlSurfaceSnapshot } from "../src/cockpit/control-surface/index.js";

async function main(): Promise<void> {
  const cwd = process.cwd();
  const { state, html } = await buildControlSurfaceSnapshot({ cwd });

  const outDir = path.join(cwd, "cockpit-reports");
  await mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "control-surface.html");
  await writeFile(outFile, html, "utf8");

  const lines = [
    `Cockpit control surface rendered â†’ ${path.relative(cwd, outFile)}`,
    `  System verdict: ${state.systemVerdict}`,
    `  Agents: ${state.bundles.map((b) => `${b.name}=${b.verdict}/${b.confidence}`).join(", ")}`,
    `  Needs-attention items: ${state.attention.length} (top: ${state.attention[0]?.severity ?? "none"})`,
    `  Builder: ${state.builder ? `${state.builder.agentName} @ ${state.builder.status}` : "none"}`,
  ];
  // eslint-disable-next-line no-console
  console.log(lines.join("\n"));
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
});

