import type { Env } from "../shared/types.js";
import { checkProviderStatus, type ProviderStatus } from "./env.js";

export function getProviderStatus(env: Env): ProviderStatus[] {
  return checkProviderStatus(env);
}

export function hasProvider(env: Env, provider: ProviderStatus["provider"]): boolean {
  return checkProviderStatus(env).some((status) => status.provider === provider && status.configured);
}
