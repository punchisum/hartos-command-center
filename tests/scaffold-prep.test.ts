/**
 * tests/scaffold-prep.test.ts
 *
 * Phase 18D-B PREP — local-only scaffold prep helper. Hermetic: a throwing global fetch is
 * installed (proves no network), the build runner is injected (no real npm), and a fake scaffold
 * is written into a temp cwd. Proves: refuses production + generic worker name; writes a disposable
 * wrangler.toml (no secrets); writes the gitignored credential template with all keys; prefills
 * from .env.local by NAME only (never values in output); preserves existing template values;
 * missing values stay blank; build-output check fails clearly when dist is missing; calls no
 * provider op; never advances the proposal; redaction holds; gitignore covers the local files.
 */

import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  saveProposal,
  markSimulatedApproved,
  approveForExecution,
  generateProposals,
  readProposal,
  type ProposalContext,
} from "../src/cockpit/proposals/index.js";
import {
  prepareScaffold,
  ScaffoldPrepError,
  parseEnvFile,
  buildWranglerToml,
  CRED_TEMPLATE_REL,
  type ShellRunner,
} from "../src/runtime-provision/scaffold-prep.js";

const NOW = "2026-06-05T12:00:00.000Z";
const DISPOSABLE = "hartos-tax-agent-smoke";
const SECRET = "cf_api_token_value_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

const EXAMPLE_WRANGLER = `name = "tax-agent"
main = "dist/src/index.js"
compatibility_date = "2026-06-03"

[vars]
APP_ENV = "local"

[env.staging.vars]
APP_ENV = "staging"
SUPABASE_URL = ""
`;

/** A runner that records calls and (optionally) "produces" dist by writing the entrypoint. */
function makeRunner(opts: { produceDist?: string; buildExit?: number } = {}): { runner: ShellRunner; calls: string[] } {
  const calls: string[] = [];
  const runner: ShellRunner = (cmd, args, _cwd) => {
    calls.push(`${cmd} ${args.join(" ")}`);
    return { status: cmd === "npm" && args[0] === "run" ? (opts.buildExit ?? 0) : 0, stdout: "", stderr: "" };
  };
  return { runner, calls };
}

async function setup(dir: string, opts: { envLocal?: string; existingTemplate?: string; withDist?: boolean } = {}): Promise<{ id: string; specId: string; scaffold: string }> {
  const ctx: ProposalContext = { request: "Create a tax agent", intent: "build_agent", panels: [], now: NOW, env: {} };
  const p = generateProposals(ctx)[0]!;
  await saveProposal(dir, p, NOW);
  await markSimulatedApproved(dir, { id: p.id }, NOW);
  await approveForExecution(dir, { id: p.id }, NOW);
  const item = await readProposal(dir, p.id);
  const specId = item!.specId!;
  const scaffold = path.join(dir, "agent-scaffold", specId);
  await mkdir(scaffold, { recursive: true });
  await writeFile(path.join(scaffold, "wrangler.toml.example"), EXAMPLE_WRANGLER, "utf8");
  await writeFile(path.join(scaffold, "package.json"), JSON.stringify({ name: "tax-agent", scripts: { build: "tsc" } }), "utf8");
  if (opts.withDist) {
    await mkdir(path.join(scaffold, "dist", "src"), { recursive: true });
    await writeFile(path.join(scaffold, "dist", "src", "index.js"), "// built\n", "utf8");
  }
  if (opts.envLocal !== undefined) await writeFile(path.join(dir, ".env.local"), opts.envLocal, "utf8");
  if (opts.existingTemplate !== undefined) {
    await mkdir(path.join(dir, ".hartos", "local"), { recursive: true });
    await writeFile(path.join(dir, CRED_TEMPLATE_REL), opts.existingTemplate, "utf8");
  }
  return { id: p.id, specId, scaffold };
}

describe("18D-B scaffold prep (no network, no provider)", () => {
  let dir: string;
  const realFetch = globalThis.fetch;
  before(() => { globalThis.fetch = (() => { throw new Error("network call attempted in prep test"); }) as typeof fetch; });
  after(() => { globalThis.fetch = realFetch; });
  beforeEach(async () => { dir = await mkdtemp(path.join(tmpdir(), "prep-")); });

  it("1. refuses --env production", async () => {
    const { id } = await setup(dir);
    await assert.rejects(
      () => prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "production", now: NOW, runner: makeRunner().runner }),
      /production/i
    );
  });

  it("2. refuses generic/default worker name (tax-agent)", async () => {
    const { id } = await setup(dir);
    await assert.rejects(
      () => prepareScaffold({ cwd: dir, ref: { id }, workerName: "tax-agent", targetEnv: "staging", now: NOW, runner: makeRunner().runner }),
      /generic|disposable/i
    );
  });

  it("3. creates a disposable wrangler.toml (staging, no secrets)", async () => {
    const { id, scaffold } = await setup(dir);
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    const toml = await readFile(path.join(scaffold, "wrangler.toml"), "utf8");
    assert.match(toml, new RegExp(`name = "${DISPOSABLE}"`));
    assert.equal(toml.includes('name = "tax-agent"'), false);
    assert.match(toml, /\[env\.staging\.vars\]/);
    assert.equal(r.wranglerPath.endsWith("wrangler.toml"), true);
  });

  it("4. creates the credential template with all required keys + comments, no values in output", async () => {
    const { id } = await setup(dir);
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    const file = await readFile(path.join(dir, CRED_TEMPLATE_REL), "utf8");
    for (const k of ["ALLOW_RUNTIME_PROVISION", "CONFIRM_RUNTIME_MUTATION", "HARTOS_TARGET_ENV", "CONFIRM_CLOUDFLARE_WORKER_NAME", "CLOUDFLARE_API_TOKEN", "TELEGRAM_BOT_TOKEN", "CONFIRM_TELEGRAM_BOT_ID", "TELEGRAM_WEBHOOK_SECRET", "TRIGGER_SECRET_KEY", "SUPABASE_URL", "HARTOS_RUNTIME_WORKER_URL"]) {
      assert.match(file, new RegExp(`^${k}=`, "m"), `template missing ${k}`);
    }
    assert.match(file, /Do NOT commit/);
    assert.match(file, /CONFIRM_RUNTIME_MUTATION=true/);
    assert.match(file, new RegExp(`SUPABASE_URL=https://xbuinrnpfjltimofwrdx`));
    // The returned summary is status-only — no '=value' content.
    assert.equal(JSON.stringify(r.credentials).includes("="), false);
  });

  it("5. prefills from .env.local — output says 'copied', never the value", async () => {
    const { id } = await setup(dir, { envLocal: `CLOUDFLARE_API_TOKEN=${SECRET}\nCLOUDFLARE_ACCOUNT_ID=acct123\n` });
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    const tok = r.credentials.find((c) => c.key === "CLOUDFLARE_API_TOKEN")!;
    assert.equal(tok.status, "copied from .env.local");
    // value is in the LOCAL file...
    const file = await readFile(path.join(dir, CRED_TEMPLATE_REL), "utf8");
    assert.match(file, new RegExp(`CLOUDFLARE_API_TOKEN=${SECRET}`));
    // ...but NEVER in the returned summary.
    assert.equal(JSON.stringify(r).includes(SECRET), false);
  });

  it("6. preserves existing non-empty template values (no --force)", async () => {
    const { id } = await setup(dir, {
      envLocal: `TELEGRAM_BOT_TOKEN=fromlocal\n`,
      existingTemplate: `TELEGRAM_BOT_TOKEN=keepme\n`,
    });
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    assert.equal(r.credentials.find((c) => c.key === "TELEGRAM_BOT_TOKEN")!.status, "already present");
    const file = await readFile(path.join(dir, CRED_TEMPLATE_REL), "utf8");
    assert.match(file, /TELEGRAM_BOT_TOKEN=keepme/);
  });

  it("7. missing values stay blank", async () => {
    const { id } = await setup(dir, { envLocal: "" });
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    for (const k of ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET", "TRIGGER_SECRET_KEY"]) {
      assert.equal(r.credentials.find((c) => c.key === k)!.status, "missing");
    }
    const file = await readFile(path.join(dir, CRED_TEMPLATE_REL), "utf8");
    assert.match(file, /^TELEGRAM_BOT_TOKEN=$/m);
  });

  it("8. build check: --build fails clearly when dist/src/index.js missing; passes when present", async () => {
    const a = await setup(dir, { withDist: false });
    await assert.rejects(
      () => prepareScaffold({ cwd: dir, ref: { id: a.id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, build: true, runner: makeRunner().runner }),
      /entrypoint is missing|dist/i
    );
    // With dist present, --build passes.
    const dir2 = await mkdtemp(path.join(tmpdir(), "prep2-"));
    const b = await setup(dir2, { withDist: true });
    const r = await prepareScaffold({ cwd: dir2, ref: { id: b.id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, build: true, runner: makeRunner().runner });
    assert.equal(r.build.npmBuild, "passed");
    assert.equal(r.build.distEntrypoint, "present");
    await rm(dir2, { recursive: true, force: true });
  });

  it("9. calls NO provider op (module imports no provider boundary)", async () => {
    const src = await readFile(path.join(process.cwd(), "src/runtime-provision/scaffold-prep.ts"), "utf8");
    assert.equal(/runtime-deploy-ops|adapters\/(cloudflare|telegram|trigger)|cloudflare-local|telegram-local|trigger-local/.test(src), false);
    // And validate-mode runs no shell at all.
    const { id } = await setup(dir);
    const { runner, calls } = makeRunner();
    await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner });
    assert.deepEqual(calls, [], "validate mode must not invoke npm");
  });

  it("10. proposal status unchanged (stays approved_for_execution)", async () => {
    const { id } = await setup(dir);
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    assert.equal(r.proposalStatus, "approved_for_execution");
    assert.equal((await readProposal(dir, id))!.status, "approved_for_execution");
  });

  it("11. secret redaction: returned summary never contains a secret-looking value", async () => {
    const tokenUrl = "https://api.telegram.org/bot123456789:" + "A".repeat(35) + "/getMe";
    const { id } = await setup(dir, { envLocal: `TELEGRAM_BOT_TOKEN=123456789:${"A".repeat(35)}\n` });
    const r = await prepareScaffold({ cwd: dir, ref: { id }, workerName: DISPOSABLE, targetEnv: "staging", now: NOW, runner: makeRunner().runner });
    const { containsSecret } = await import("../src/llm/redaction.js");
    assert.equal(containsSecret(JSON.stringify(r)), false);
    assert.equal(JSON.stringify(r).includes(tokenUrl), false);
  });

  it("12. gitignore covers the local cred template + generated scaffold wrangler", async () => {
    const gi = await readFile(path.join(process.cwd(), ".gitignore"), "utf8");
    assert.match(gi, /\.hartos\/local\//);
    assert.match(gi, /agent-scaffold\//); // covers agent-scaffold/**/wrangler.toml
  });

  it("parseEnvFile/buildWranglerToml unit checks", () => {
    const m = parseEnvFile('A=1\n# c\nB="two"\n\nC=\n');
    assert.equal(m.get("A"), "1");
    assert.equal(m.get("B"), "two");
    assert.equal(m.get("C"), "");
    const toml = buildWranglerToml(EXAMPLE_WRANGLER, DISPOSABLE, "staging");
    assert.match(toml, new RegExp(`name = "${DISPOSABLE}"`));
    const synth = buildWranglerToml(null, DISPOSABLE, "test");
    assert.match(synth, /\[env\.test\.vars\]/);
  });
});
