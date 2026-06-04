import { handleRequest } from "./runtime/cloudflare-worker.js";
import type { Env } from "./shared/types.js";

export default {
  fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env);
  },
};
