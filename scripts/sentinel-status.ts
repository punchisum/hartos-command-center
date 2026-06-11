/**
 * scripts/sentinel-status.ts — Sentinel CLI: fleet liveness from LOCAL evidence.
 *
 * Gathers each agent's newest evidence via the shared host edge (artifact-dir mtimes + the
 * memory-capture file), folds it with the meta-agent registry via the pure Sentinel core,
 * and prints the per-agent verdicts + rollup. Read-only; exit 1 on a RED fleet so a
 * cron/heartbeat wrapper can alert. Agents with no local evidence source are reported
 * "unknown" — honest, never assumed up.
 *
 *   npm run sentinel:status
 */

import { resolveMetaAgentRegistry } from "../src/agents/meta-agent-registry.js";
import { assessFleetLiveness, describeFleetLiveness } from "../src/sentinel/sentinel-liveness.js";
import { gatherLocalHeartbeats } from "../src/sentinel/sentinel-host.js";

const now = new Date().toISOString();
const registry = resolveMetaAgentRegistry({ now });
const fleet = assessFleetLiveness(registry, gatherLocalHeartbeats(process.env), now);
console.log(describeFleetLiveness(fleet));
process.exit(fleet.overall === "RED" ? 1 : 0);
