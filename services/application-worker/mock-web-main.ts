import { runWebMockWorker, setupWebMockQueue } from "./mock-web-runtime";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--setup") return setupWebMockQueue();
  if (args.length === 1 && args[0] === "--run") return runWebMockWorker();
  throw new Error("Explicit isolated web mock setup or run required.");
}
void main().catch(() => { console.error(JSON.stringify({ status: "FAIL", code: "IsolatedWebMockFailed", rawOutput: "withheld" })); process.exitCode = 1; });
