/**
 * scripts/beezulbub-capability-list.ts
 *
 * beezulbub:capability-list — List capabilities from the registry.
 */

import path from "node:path";
import { loadRegistry, formatCapabilityList } from "../src/beezulbub/capability-registry.js";

const cwd = process.cwd();
const registryPath = process.env["BEEZULBUB_CAPABILITY_REGISTRY_PATH"]
  ?? path.join(cwd, "capabilities", "capability-registry.json");

// loadRegistry never throws — handles missing/corrupt files internally
const registry = await loadRegistry(registryPath);
console.log(formatCapabilityList(registry));
