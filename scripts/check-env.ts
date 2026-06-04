import { checkProviderStatus, getEnv, printProviderStatus } from "../src/runtime/env.js";

printProviderStatus(checkProviderStatus(getEnv()));
console.log("Environment check completed. Values were not printed.");
