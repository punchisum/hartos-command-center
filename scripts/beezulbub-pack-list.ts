/**
 * scripts/beezulbub-pack-list.ts
 *
 * List all generated pack skeletons.
 * No network. No mutations.
 *
 * Usage: npm run beezulbub:pack-list
 */

import path from "node:path";
import { getEnv, optionalEnv } from "../src/runtime/env.js";
import { listPacks, formatPackList } from "../src/beezulbub/pack-registry.js";

const root = process.cwd();
const env = getEnv() as Record<string, string | undefined>;
const packOutputDir = optionalEnv(env, "BEEZULBUB_PACK_OUTPUT_DIR") ?? "packs";
const packsDir = path.join(root, packOutputDir);

console.log(`\nBeezulbub Pack List: test-agent`);
console.log(`Packs directory: ${packsDir}`);
console.log(`Timestamp: ${new Date().toISOString()}`);
console.log("");

const packs = await listPacks(packsDir);
const formatted = formatPackList(packs);
console.log(formatted);
