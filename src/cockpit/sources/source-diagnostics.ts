/**
 * src/cockpit/sources/source-diagnostics.ts
 *
 * Phase 13.5A — read-only source diagnostics. Reports, per domain, whether the
 * read-model is configured / enabled / disabled / missing env / stale /
 * rejected-as-unsafe, plus the exact next setup step. NEVER prints or stores a
 * secret value (it only inspects key *presence* and a locally-decoded role
 * claim). Service-role keys are flagged as rejected.
 */

import { loadReadModelRegistry, resolveAvailability, type LoadedReadModelRegistry } from "../../read-models/read-model-registry.js";
import type { FitnessRpcStatus, ReadModelSummary } from "../../read-models/read-model-types.js";
import type { Freshness } from "./source-types.js";
import type { ResolvedSources } from "./index.js";
import { isServiceRoleKey } from "./secret-guard.js";

export type DiagStatus =
  | "live"
  | "stale"
  | "disabled"
  | "missing_env"
  | "not_configured"
  | "rejected_unsafe"
  | "reports_only"
  | "unavailable";

export interface DomainSourceDiag {
  domain: "fitness" | "ops" | "factory";
  configured: boolean;
  enabled: boolean;
  status: DiagStatus;
  freshness: Freshness;
  resolvedFields: number;
  missingEnv: string[];
  rejectedUnsafe: boolean;
  setupStep: string | null;
  note: string;
  /** Phase 13.6 — transport used for this domain's read-model. */
  transport?: "rpc" | "table";
  /** Phase 13.6 — precise RPC outcome when transport is "rpc" (Fitness). */
  rpcStatus?: FitnessRpcStatus;
}

export interface SourceDiagnosticsReport {
  generatedAt: string;
  configPresent: boolean;
  configPath: string | null;
  domains: DomainSourceDiag[];
  configuredSources: string[];
  enabledSources: string[];
  disabledSources: string[];
  missingSources: string[];
  staleSources: string[];
  rejectedSources: string[];
}

type Env = Record<string, string | undefined>;

const ENABLE_STEP = (domain: string) =>
  `Enable a ${domain} read-model in read-models.local.json (mode supabase_readonly, read-only anon key) and run \`npm run read-models:status\`.`;

export interface DiagnosticsOptions {
  /** Optional on the hosted path — when `registry` is injected, fs is untouched. */
  cwd?: string;
  now: string;
  sources: ResolvedSources;
  env?: Env;
  /** Phase 13.6 — read-model summaries, used to surface precise RPC status. */
  readModelSummaries?: ReadModelSummary[];
  /**
   * Phase 16D — inject a pre-built registry (hosted Worker has no filesystem).
   * When provided, no fs access and no process.cwd lookup occurs.
   */
  registry?: LoadedReadModelRegistry;
}

/** Phase 13.6 — precise, secret-free note for an RPC-backed Fitness read-model. */
const RPC_NOTE: Record<FitnessRpcStatus, string> = {
  rpc_configured: "RPC-backed fitness read-model configured.",
  rpc_live: "Live read-only RPC data resolved.",
  rpc_missing_env: "RPC-backed, but the user/agent id args are not set.",
  rpc_unavailable: "RPC-backed, but the read-only fitness RPCs are not exposed.",
  rpc_forbidden: "RPC-backed, but EXECUTE on the fitness RPCs is not granted to the read-only role.",
  rpc_no_rows: "RPCs reachable but returned no rows for the configured user/agent id.",
  rpc_shape_mismatch: "RPCs reachable but returned an unexpected shape.",
};

function rpcDiagStatus(rpc: FitnessRpcStatus, base: DiagStatus): DiagStatus {
  switch (rpc) {
    case "rpc_live": return "live";
    case "rpc_missing_env": return base === "live" ? "live" : "missing_env";
    default: return base === "live" ? "live" : "unavailable";
  }
}

export async function buildSourceDiagnostics(options: DiagnosticsOptions): Promise<SourceDiagnosticsReport> {
  const env = options.env ?? process.env;
  const registry = options.registry ?? (await loadReadModelRegistry(options.cwd ?? process.cwd()));

  const configuredSources: string[] = [];
  const enabledSources: string[] = [];
  const disabledSources: string[] = [];
  const missingSources: string[] = [];
  const staleSources: string[] = [];
  const rejectedSources: string[] = [];

  function readModelDomain(domain: "fitness" | "ops"): DomainSourceDiag {
    const config = registry.readModels.find((c) => c.type === domain);
    const avail = config ? resolveAvailability(config, env) : undefined;
    const source = options.sources[domain];
    const resolvedFields = Object.keys(source.values).length;
    const freshness: Freshness = source.freshness;

    const configured = !!config;
    const enabled = !!avail?.enabled;
    // Inspect key presence/role only — never the value.
    const rejectedUnsafe = !!config && isServiceRoleKey(env[config.supabaseKeyEnv]);
    const missingEnv = avail?.missingEnv ?? [];

    let status: DiagStatus;
    let setupStep: string | null = null;
    let note: string;
    if (rejectedUnsafe) {
      status = "rejected_unsafe";
      setupStep = `Replace the ${domain} read-model key with a read-only anon/publishable key (service_role keys are rejected).`;
      note = "A service_role key was detected and rejected for read-only cockpit use.";
    } else if (!configured) {
      status = resolvedFields > 0 ? "reports_only" : "not_configured";
      setupStep = ENABLE_STEP(domain);
      note = resolvedFields > 0 ? "No read-model; using local reports/handover only." : "No read-model configured for this domain.";
    } else if (!enabled) {
      status = resolvedFields > 0 ? "reports_only" : "disabled";
      setupStep = `Set enabled=true for the ${domain} read-model in read-models.local.json.`;
      note = "Read-model is configured but disabled.";
    } else if (missingEnv.length > 0) {
      status = resolvedFields > 0 ? "reports_only" : "missing_env";
      setupStep = `Set the env vars: ${missingEnv.join(", ")}.`;
      note = "Read-model enabled but env is missing.";
    } else if (freshness === "stale") {
      status = "stale";
      setupStep = `Refresh the ${domain} read-model data (latest rows are older than the freshness window).`;
      note = "Live data is present but stale.";
    } else if (resolvedFields > 0) {
      status = "live";
      note = "Live read-only data resolved.";
    } else {
      status = "unavailable";
      setupStep = ENABLE_STEP(domain);
      note = "Enabled but no rows resolved.";
    }

    // Phase 13.6 — overlay precise RPC status for an RPC-backed Fitness read-model.
    let transport: DomainSourceDiag["transport"];
    let rpcStatus: FitnessRpcStatus | undefined;
    if (!rejectedUnsafe && configured && (config?.allowedRpcs.length ?? 0) > 0) {
      transport = "rpc";
      const rmSummary = options.readModelSummaries?.find((s) => s.type === domain);
      rpcStatus = rmSummary?.rpcStatus;
      if (rpcStatus) {
        status = rpcDiagStatus(rpcStatus, status);
        note = RPC_NOTE[rpcStatus];
        // Prefer the adapter's precise, secret-free recommendation as the setup step.
        if (status !== "live") setupStep = rmSummary?.recommendation ?? setupStep;
        else setupStep = null;
      }
    } else if (configured) {
      transport = "table";
    }

    if (configured) configuredSources.push(domain);
    if (enabled) enabledSources.push(domain);
    if (configured && !enabled) disabledSources.push(domain);
    if (enabled && missingEnv.length > 0) missingSources.push(domain);
    if (status === "stale") staleSources.push(domain);
    if (rejectedUnsafe) rejectedSources.push(domain);
    if (status === "missing_env" && !missingSources.includes(domain)) missingSources.push(domain);

    return { domain, configured, enabled, status, freshness, resolvedFields, missingEnv, rejectedUnsafe, setupStep, note, transport, rpcStatus };
  }

  const factory = ((): DomainSourceDiag => {
    const source = options.sources.factory;
    const resolvedFields = Object.keys(source.values).length;
    const status: DiagStatus = resolvedFields > 0 ? "reports_only" : "unavailable";
    return {
      domain: "factory",
      configured: false,
      enabled: false,
      status,
      freshness: source.freshness,
      resolvedFields,
      missingEnv: [],
      rejectedUnsafe: false,
      setupStep: status === "unavailable" ? "Run `npm run verify` / Orchestrator commands to produce reports." : null,
      note: status === "reports_only" ? "Using local reports + capability registry." : "No reports yet.",
    };
  })();

  return {
    generatedAt: options.now,
    configPresent: registry.configPresent,
    configPath: registry.configPath ? "read-models.local.json" : null,
    domains: [readModelDomain("fitness"), readModelDomain("ops"), factory],
    configuredSources,
    enabledSources,
    disabledSources,
    missingSources,
    staleSources,
    rejectedSources,
  };
}
