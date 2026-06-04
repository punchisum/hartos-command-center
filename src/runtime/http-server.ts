import type { Env } from "../shared/types.js";
import { handleRequest } from "./cloudflare-worker.js";

export function createLocalHandler(env: Env): (request: Request) => Promise<Response> {
  return (request) => handleRequest(request, env);
}
