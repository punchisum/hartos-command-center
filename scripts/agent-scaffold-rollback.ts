/**
 * scripts/agent-scaffold-rollback.ts
 *
 * Phase 18A — automated rollback of a local scaffold. Because 18A never pushes or provisions, undo
 * is a clean local delete: remove the scaffold workdir + the PR-prep dir. Nothing remote to revert.
 *
 * Usage:
 *   npm run agent:scaffold-rollback -- --spec=<specId>
 */

import { rollbackLocalScaffold } from "../src/execution/index.js";

const spec = process.argv.find((a) => a.startsWith("--spec="))?.replace("--spec=", "");
if (!spec) {
  console.error("Provide --spec=<specId>.");
  process.exit(1);
}

const removed = await rollbackLocalScaffold({ cwd: process.cwd(), specId: spec });
if (removed.length === 0) {
  console.log(`Nothing to remove for spec ${spec}.`);
} else {
  console.log(`Rolled back local scaffold for ${spec}:`);
  for (const d of removed) console.log(`  removed ${d}`);
}
