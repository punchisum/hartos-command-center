import { getEnv, printProviderStatus, checkProviderStatus } from "../src/runtime/env.js";

printProviderStatus(checkProviderStatus(getEnv()));
