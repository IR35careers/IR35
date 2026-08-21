import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));

function git(args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    maxBuffer,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

const secretPatterns = [
  ["OpenAI or OpenRouter key", /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/g],
  ["Resend key", /\bre_[A-Za-z0-9_-]{20,}\b/g],
  ["Supabase secret key", /\bsb_secret_[A-Za-z0-9_-]{20,}\b/g],
  ["Stripe live secret", /\bsk_live_[A-Za-z0-9]{16,}\b/g],
  ["GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g],
  ["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g],
  ["Private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g],
];

function detectedSecretKinds(content) {
  return secretPatterns
    .filter(([, pattern]) => {
      pattern.lastIndex = 0;
      return pattern.test(content);
    })
    .map(([name]) => name);
}

const trackedFiles = git(["ls-files", "-z"])
  .split("\0")
  .filter(Boolean);
const findings = [];

for (const file of trackedFiles) {
  const buffer = readFileSync(resolve(root, file));
  if (buffer.includes(0)) continue;
  const kinds = detectedSecretKinds(buffer.toString("utf8"));
  if (kinds.length) findings.push(`${file}: ${kinds.join(", ")}`);
}

const history = git([
  "log",
  "--all",
  "--patch",
  "--no-ext-diff",
  "--format=commit:%H",
  "--",
  ":(exclude)package-lock.json",
], 192 * 1024 * 1024);
const historyKinds = detectedSecretKinds(history);
if (historyKinds.length) findings.push(`Git history: ${historyKinds.join(", ")}`);

const allowedEnvironmentFiles = new Set([".env.example", ".env.local.example"]);
for (const file of trackedFiles.filter((value) => /(^|\/)\.env(?:\.|$)/.test(value))) {
  if (!allowedEnvironmentFiles.has(file)) findings.push(`${file}: tracked environment file`);
}

for (const file of trackedFiles.filter((value) => /^\.github\/workflows\/[^/]+\.ya?ml$/.test(value))) {
  const workflow = readFileSync(resolve(root, file), "utf8");
  for (const match of workflow.matchAll(/\buses:\s*([^\s#]+)@([^\s#]+)/g)) {
    if (match[1].startsWith("./")) continue;
    if (!/^[0-9a-f]{40}$/i.test(match[2])) {
      findings.push(`${file}: action ${match[1]} is not pinned to an immutable commit`);
    }
  }
}

for (const file of trackedFiles.filter((value) => /\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(value))) {
  const source = readFileSync(resolve(root, file), "utf8");
  const publicSecret = source.match(/NEXT_PUBLIC_[A-Z0-9_]*(?:SECRET|PRIVATE|PASSWORD|SERVICE_ROLE|ACCESS_TOKEN)/g);
  if (publicSecret?.length) findings.push(`${file}: sensitive-looking NEXT_PUBLIC variable name`);
}

if (!trackedFiles.includes("package-lock.json")) findings.push("package-lock.json: missing reproducible dependency lock");

if (findings.length) {
  console.error("Security source check failed:");
  for (const finding of findings) console.error(`- ${finding}`);
  process.exit(1);
}

console.log(`Security source check passed (${trackedFiles.length} tracked files, repository history scanned).`);
