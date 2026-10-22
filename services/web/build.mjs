import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

// BuildKit mount only. No service key, SMTP/provider credential or cloud secret
// enters the build. These are fresh staging PUBLIC client settings only.
const allowed = new Set(["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY"]);
const values = {};
for (const line of readFileSync("/opt/ir35/.env.web-build", "utf8").trim().split("\n")) {
  const match = /^([A-Z][A-Z0-9_]*)='([^'\r\n]*)'$/.exec(line);
  if (!match || !allowed.has(match[1]) || match[1] in values) throw new Error("Build environment boundary refused");
  values[match[1]] = match[2];
}
if (new URL(values.NEXT_PUBLIC_SUPABASE_URL).href !== "https://staging.ir35careers.com/supabase") throw new Error("Staging build URL required");
const jwt = JSON.parse(Buffer.from(values.NEXT_PUBLIC_SUPABASE_ANON_KEY.split(".")[1] ?? "", "base64url").toString());
if (jwt.role !== "anon") throw new Error("Only fresh public anon key may enter build");
const result = spawnSync(process.execPath, ["node_modules/next/dist/bin/next", "build"], {
  env: { ...process.env, ...values, NEXT_TELEMETRY_DISABLED: "1", NODE_OPTIONS: "--max-old-space-size=1024" }, stdio: "inherit",
});
process.exit(result.status ?? 1);
