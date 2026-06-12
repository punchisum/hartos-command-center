/**
 * scripts/run-telegram-notify-once.ts — run ONE approval-notify pass on demand.
 *
 * Reads the spine's pending_approval proposals and, when the notifier is armed, sends Hart a
 * deduped Telegram digest — then exits. This is both the verification tool (proves the live
 * read→format→send path end-to-end) and a manual "ping me what's awaiting my approval" trigger.
 * Honest no-op (prints the reason) when disarmed/unconfigured. Per-run dedupe starts empty, so a
 * one-shot always announces whatever is currently pending.
 *
 *   npm run notify:once
 */

import { pathToFileURL } from "node:url";
import { runApprovalNotifyPass } from "../src/telegram/run-approval-notify.js";
import { redact } from "../src/llm/redaction.js";

const isMain = typeof process.argv[1] === "string" && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runApprovalNotifyPass(process.env, new Set<string>())
    .then((r) => {
      if (!r.configured) {
        console.log(`telegram notify — DISARMED/unconfigured: ${r.reason}`);
      } else if (r.sent) {
        console.log(`telegram notify — SENT a digest of ${r.count} pending proposal(s) to Hart.`);
      } else {
        console.log(`telegram notify — armed, but 0 proposals are pending_approval right now (nothing to send).`);
      }
      process.exit(0);
    })
    .catch((e) => {
      console.error(`telegram notify failed: ${redact(e instanceof Error ? e.message : String(e))}`);
      process.exit(1);
    });
}
