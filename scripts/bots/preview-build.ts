import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import { previewBuildEnvironment } from "./vercel-config";

async function main() {
  const env = previewBuildEnvironment(process.env);
  if ((await readdir(process.cwd())).some(name => /^\.env(?:\.|$)/.test(name) && !name.endsWith(".example")))
    throw new Error("Mock builds refuse local environment files.");
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "build"], { env, stdio: "inherit", windowsHide: true });
  const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  if (code !== 0) throw new Error("Mock preview build failed.");
}
main().catch(() => { console.error("Isolated preview build stopped; no secrets or production settings emitted."); process.exitCode = 1; });
