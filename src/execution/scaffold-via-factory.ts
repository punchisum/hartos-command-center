/**
 * src/execution/scaffold-via-factory.ts
 *
 * Phase 18A — the CC→Factory handoff. Command Center NEVER re-implements Factory config/scaffold
 * logic; it spawns the Factory as a LOCAL process (17C-3), hands it a spec-draft file + an output
 * dir, and consumes the file manifest it writes. The Factory is invoked as a child process (not an
 * imported module), so it stays entirely out of CC's Worker bundle and shares no module graph.
 *
 * This is a fs + child-process handoff only. There is NO network here, and the scaffold function is
 * injectable so CC's tests run hermetically without the Factory checkout present.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";

export interface ScaffoldRequest {
  /** Path to the CC-written plan-level spec draft JSON. */
  specDraftPath: string;
  /** Directory the Factory should scaffold the agent repo into (created if missing). */
  outDir: string;
  /** Factory skills to copy. */
  skills: string[];
  /** Deterministic createdAt for the resolved AgentConfig. */
  createdAt: string;
}

export interface ScaffoldOutcome {
  /** Files (relative to outDir) the scaffold produced. */
  files: string[];
}

/** Injectable scaffold function. Real default spawns the Factory CLI; tests pass a fake. */
export type ScaffoldFn = (req: ScaffoldRequest) => Promise<ScaffoldOutcome>;

async function walkRel(root: string, dir: string, acc: string[]): Promise<void> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === "dist") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walkRel(root, full, acc);
    else acc.push(path.relative(root, full).split(path.sep).join("/"));
  }
}

function runNode(scriptPath: string, args: string[], cwd: string): void {
  const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd, encoding: "utf8", stdio: "pipe" });
  if ((result.status ?? 1) !== 0) {
    const err = ((result.stderr ?? "") + (result.stdout ?? "")).trim().slice(0, 500);
    throw new Error(`Factory step failed (${path.basename(scriptPath)}): ${err}`);
  }
}

/**
 * Default real scaffold: locate the built Factory, resolve the draft → AgentConfig, then scaffold.
 * Factory location comes from HARTOS_FACTORY_PATH or a sibling `hartos-agent-factory` checkout.
 * No network. Throws a clear error if the Factory is absent/unbuilt (so the caller can guide setup).
 */
export const realFactoryScaffold: ScaffoldFn = async (req: ScaffoldRequest): Promise<ScaffoldOutcome> => {
  const factoryRoot =
    process.env["HARTOS_FACTORY_PATH"] ??
    path.resolve(process.cwd(), "..", "hartos-agent-factory");
  const resolveScript = path.join(factoryRoot, "dist", "scripts", "resolve-agent-spec.js");
  const createScript = path.join(factoryRoot, "dist", "scripts", "create-agent-project.js");
  if (!existsSync(resolveScript) || !existsSync(createScript)) {
    throw new Error(
      `Agent Factory not found/built at ${factoryRoot}. Set HARTOS_FACTORY_PATH and run its build first.`
    );
  }

  const configPath = path.join(path.dirname(req.specDraftPath), "agent-config.resolved.json");
  runNode(resolveScript, [`--in=${req.specDraftPath}`, `--out=${configPath}`, `--created-at=${req.createdAt}`], factoryRoot);
  runNode(
    createScript,
    [req.outDir, `--config=${configPath}`, `--skills=${req.skills.join(",")}`, "--force"],
    factoryRoot
  );

  const files: string[] = [];
  if (existsSync(req.outDir)) await walkRel(req.outDir, req.outDir, files);
  return { files: files.sort() };
};
