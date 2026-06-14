/**
 * src/execution/self-mod-armory-store.ts — Phase 6 (Amendment §6): the daemon-local file-backed
 * ArmoryStore. Persists the circuit-breaker disarm marker + last-auto-deploy timestamp in a JSON file
 * so they survive daemon restarts — no DB migration needed. Fail-closed: a corrupt state file reads as
 * disarmed (block auto-apply). A fresh install (no file) is NOT disarmed (arming is via the env flags).
 * Injectable fs so tests are hermetic. NODE HOST ONLY.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { ArmoryStore } from "./self-mod-armory.js";

export interface FsLike {
  exists(path: string): boolean;
  read(path: string): string;
  write(path: string, data: string): void;
}

export const realFs: FsLike = {
  exists: (p) => existsSync(p),
  read: (p) => readFileSync(p, "utf8"),
  write: (p, d) => writeFileSync(p, d, "utf8"),
};

interface SelfModState {
  disarmed: boolean;
  disarmReason?: string;
  lastAutoDeployAt: number | null;
}

const FRESH: SelfModState = { disarmed: false, lastAutoDeployAt: null };

function parse(raw: string): SelfModState {
  const s = JSON.parse(raw) as Partial<SelfModState>;
  return {
    disarmed: s.disarmed === true,
    disarmReason: typeof s.disarmReason === "string" ? s.disarmReason : undefined,
    lastAutoDeployAt: typeof s.lastAutoDeployAt === "number" ? s.lastAutoDeployAt : null,
  };
}

/** A file-backed ArmoryStore. Corrupt file ⇒ disarmed (fail-closed); missing file ⇒ fresh (not disarmed). */
export function fileArmoryStore(path: string, fs: FsLike = realFs): ArmoryStore {
  /** Read the state for a WRITE (corrupt/missing ⇒ a clean fresh base so we never propagate corruption). */
  const readForWrite = (): SelfModState => {
    if (!fs.exists(path)) return { ...FRESH };
    try { return parse(fs.read(path)); } catch { return { ...FRESH }; }
  };
  const writeState = (s: SelfModState): void => fs.write(path, JSON.stringify(s, null, 2));

  return {
    isDisarmed: () => {
      if (!fs.exists(path)) return false; // fresh install — the breaker hasn't tripped; arming is via the flags
      try { return parse(fs.read(path)).disarmed; } catch { return true; } // corrupt state ⇒ fail-closed
    },
    setDisarmed: (reason: string) => writeState({ ...readForWrite(), disarmed: true, disarmReason: reason }),
    clearDisarmed: () => writeState({ ...readForWrite(), disarmed: false, disarmReason: undefined }),
    lastAutoDeployAt: () => readForWrite().lastAutoDeployAt,
    recordAutoDeploy: (at: number) => writeState({ ...readForWrite(), lastAutoDeployAt: at }),
  };
}
