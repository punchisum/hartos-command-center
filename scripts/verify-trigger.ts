import { getEnv } from "../src/runtime/env.js";

const env = getEnv();
console.log(`trigger: ${env.TRIGGER_SECRET_KEY ? "configured" : "not configured"}`);
console.log("Trigger task registration is a Phase 5 implementation step. No secret values were printed.");
