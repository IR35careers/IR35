import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { scanMigrationSource } from "../infra/oracle/inventory";

try {
  if (process.argv.length !== 2) throw new Error("No arguments accepted.");
  const paths = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 2_000_000 }).split("\0")
    .filter(path => /\.(?:tsx?|[cm]?js|json|ya?ml|sh|ps1)$|(?:^|\/)Dockerfile$|\.env[^/]*example$/.test(path))
    .filter(path => !path.endsWith("package-lock.json") && !path.startsWith("tests/") && !path.startsWith("docs/"));
  const inventory = scanMigrationSource(Object.fromEntries(paths.map(path => [path, readFileSync(path, "utf8")])));
  writeFileSync(new URL("../docs/oracle-source-inventory.json", import.meta.url), `${JSON.stringify(inventory, null, 2)}\n`);
  console.log(JSON.stringify({ files: inventory.sourceFiles, environmentNames: inventory.environmentNames.length,
    featureReferences: inventory.features.length, valuesIncluded: false }));
} catch {
  console.error("Source inventory failed; no source values or secrets logged."); process.exitCode = 1;
}
