/** P7 Council arming + caps. Fail-closed: armed only by HARTOS_ALLOW_COUNCIL=true AND kill-switch off. */
type Env = Record<string, string | undefined>;

export const COUNCIL_ALLOW_ENV = "HARTOS_ALLOW_COUNCIL";
export const KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";

export const COUNCIL_CAPS = { maxDepth: 3, maxPanel: 6, maxLlmCalls: 30, specialistTimeoutMs: 60_000 } as const;

export function councilArmedFromEnv(env: Env): boolean {
  if ((env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on") return false;
  return (env[COUNCIL_ALLOW_ENV] ?? "").trim() === "true";
}
