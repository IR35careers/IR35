import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { combineCatalogSecurity, compareCloudClone } from "./oracle-cloud-drift";

if (process.argv.length !== 2) throw new Error("Fixed staging metadata reports only.");
const cache = (name: string) => readFileSync(new URL(`../.cache/oracle-schema/acl-${name}.json`, import.meta.url));
const result = compareCloudClone(JSON.parse(cache("source").toString()), JSON.parse(cache("clone").toString()));
const combined = combineCatalogSecurity(result, JSON.parse(readFileSync(new URL("../docs/evidence/oracle-p3-acl-security.json", import.meta.url), "utf8")));
const inputSHA256 = Object.fromEntries(["source", "clone"].map(name => [name, createHash("sha256").update(cache(name)).digest("hex")]));
inputSHA256.security = createHash("sha256").update(readFileSync(new URL("../docs/evidence/oracle-p3-acl-security.json", import.meta.url))).digest("hex");
writeFileSync(new URL("../docs/evidence/oracle-p3-acl-gate.json", import.meta.url), JSON.stringify({ ...combined, inputSHA256 }, null, 2) + "\n");
console.log(JSON.stringify({ status: combined.status, catalogDifferences: result.differences.length, roleAttributeDifferences: combined.roleAttributeDifferences.length, exceptions: result.exceptions }));
if (combined.status === "FAIL") process.exitCode = 1;
