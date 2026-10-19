import base from "../../vercel.base.json";

export const BOT_PREVIEW_PROJECT_ID = "prj_EvKGpPqbdFSKLveYYQ7bRVPly5Zs";
export const BOT_PREVIEW_PROJECT_NAME = "ir35-bot-preview";

export function projectConfig(projectId: string | undefined) {
  if (projectId !== BOT_PREVIEW_PROJECT_ID) return structuredClone(base);
  return {
    framework: "nextjs",
    git: { deploymentEnabled: { "*": false, "main": false, "codex/issue-*": true, "codex/bot-handoff": true } },
    installCommand: "npm ci --ignore-scripts",
    buildCommand: "node --import tsx scripts/bots/preview-build.ts",
    // No production scheduler, Vercel queue consumer, integrations or domains.
    functions: {},
    crons: [],
    headers: [{ source: "/(.*)", headers: [
      { key: "X-IR35-Bot-Preview", value: "mock-only-v1" },
      { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" },
    ] }],
  };
}

export function previewBuildEnvironment(input: Readonly<Record<string, string | undefined>>) {
  if (input.VERCEL_PROJECT_ID !== BOT_PREVIEW_PROJECT_ID || input.VERCEL_ENV !== "preview" ||
    input.IR35CAREERS_E2E_DEMO_DATA !== "1" || input.IR35CAREERS_BOT_PREVIEW !== "1")
    throw new Error("Only the isolated mock Preview project may use this build.");
  for (const [name, value] of Object.entries(input)) {
    if (value && !name.startsWith("VERCEL_") && /SUPABASE|DATABASE|PG_BOSS|REED_API|ADZUNA|RESEND|POSTMARK|STRIPE|OPENAI|OPENROUTER|APPLICATION_WORKER|CRON_SECRET|SMTP|GITHUB_TOKEN/i.test(name))
      throw new Error("A prohibited application credential/configuration is present; no value emitted.");
  }
  // Never copy all process.env into build/test children.
  const permitted = ["PATH", "HOME", "TMP", "TEMP", "TMPDIR", "SystemRoot", "COMSPEC", "CI",
    "VERCEL", "VERCEL_ENV", "VERCEL_URL", "VERCEL_PROJECT_ID", "VERCEL_GIT_COMMIT_REF", "VERCEL_GIT_COMMIT_SHA"];
  const env: NodeJS.ProcessEnv = { NODE_ENV: "production", NEXT_TELEMETRY_DISABLED: "1",
    IR35CAREERS_E2E_DEMO_DATA: "1", IR35CAREERS_BOT_PREVIEW: "1",
    NEXT_PUBLIC_SUPABASE_URL: "", NEXT_PUBLIC_SUPABASE_ANON_KEY: "", NEXT_PUBLIC_GOOGLE_CLIENT_ID: "" };
  for (const name of permitted) if (input[name] !== undefined) env[name] = input[name];
  return env;
}
