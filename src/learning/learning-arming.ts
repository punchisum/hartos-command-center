/** P8 Learning arming gate. Fail-closed: armed only by HARTOS_ALLOW_LEARNING=true AND kill-switch off. */
type Env = Record<string, string | undefined>;

export const LEARNING_ALLOW_ENV = "HARTOS_ALLOW_LEARNING";
export const KILL_SWITCH_ENV = "HARTOS_EXECUTION_KILL_SWITCH";

export function learningArmedFromEnv(env: Env): boolean {
  if ((env[KILL_SWITCH_ENV] ?? "").trim().toLowerCase() === "on") return false;
  return (env[LEARNING_ALLOW_ENV] ?? "").trim() === "true";
}
