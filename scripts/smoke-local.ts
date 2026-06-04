import worker from "../src/index.js";

const response = await worker.fetch(new Request("http://local.test/health"), {});
if (!response.ok) {
  throw new Error(`Local smoke failed with status ${response.status}`);
}

console.log("Local runtime smoke passed.");
