import { spawn } from "node:child_process";
import { copyFile, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "esbuild";
import { previewBuildEnvironment } from "./vercel-config";

async function copyReviewedTree(source: string, destination: string) {
  await mkdir(destination, { recursive: true });
  for (const entry of await readdir(source, { withFileTypes: true })) {
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile()) || /^\.env(?:\.|$)/.test(entry.name))
      throw new Error("Unreviewed source entry in isolated preview.");
    const from = join(source, entry.name), to = join(destination, entry.name);
    if (entry.isDirectory()) await copyReviewedTree(from, to);
    else await copyFile(from, to);
  }
}

async function main() {
  const env = previewBuildEnvironment(process.env);
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const preview = join(root, "bot-preview");
  if (resolve(process.cwd()) !== preview) throw new Error("Build must run from the dedicated mock project root.");
  for (const directory of [root, preview]) {
    if ((await readdir(directory)).some(name => /^\.env(?:\.|$)/.test(name) && !name.endsWith(".example")))
      throw new Error("Mock builds refuse local environment files.");
  }
  // Copy only the real application and public assets, never local env files,
  // operational output, .vercel state, worker secrets, or the rest of the repo.
  for (const directory of ["src", "public"]) await copyReviewedTree(join(root, directory), join(preview, directory));
  for (const file of ["tsconfig.json", "tailwind.config.ts", "postcss.config.mjs"]) await copyFile(join(root, file), join(preview, file));
  const config = await transform(await readFile(join(root, "next.config.ts"), "utf8"), { loader: "ts", format: "cjs", platform: "node", target: "node22" });
  await writeFile(join(preview, "next.base.cjs"), config.code, "utf8");
  const child = spawn(process.execPath, [join(root, "node_modules/next/dist/bin/next"), "build"], { cwd: preview, env, stdio: "inherit", windowsHide: true });
  const code = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", code => resolve(code ?? 1)); });
  if (code !== 0) throw new Error("Mock preview build failed.");
}
main().catch(() => { console.error("Isolated preview build stopped; no secrets or production settings emitted."); process.exitCode = 1; });
