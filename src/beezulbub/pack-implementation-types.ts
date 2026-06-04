/**
 * src/beezulbub/pack-implementation-types.ts
 *
 * Types for the Pack Implementation Engine (Phase 11E).
 */

export type ImplementStatus =
  | "implemented"
  | "blocked_missing_approval"
  | "blocked_bad_status"
  | "blocked_bad_verdict"
  | "blocked_no_provenance"
  | "failed";

export interface ImplementationFile {
  relativePath: string;
  content: string;
}

export interface ImplementResult {
  status: ImplementStatus;
  packName: string;
  packPath: string;
  message: string;
  filesGenerated: string[];
  capabilityType: string;
}

export interface ImplementOptions {
  packPath: string;
  approveImplementation: boolean;
  allowPackImplement: boolean;
  ledgerPath?: string;
  registryPath?: string;
  cwd?: string;
}
