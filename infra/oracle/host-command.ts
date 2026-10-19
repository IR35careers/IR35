import { execFile } from "node:child_process";

/** Never surface stderr, arguments, stdin or inherited secrets in operational errors. */
export function hostCommand(file: "docker" | "cosign", args: readonly string[], options: {
  env: NodeJS.ProcessEnv; input?: string; timeoutMs?: number;
}): Promise<string> {
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Worker host command failed; no sensitive diagnostics emitted."));
    try {
      const child = execFile(file, [...args], { encoding: "utf8", env: options.env,
        timeout: options.timeoutMs ?? 60_000, maxBuffer: 524_288, windowsHide: true },
      (error, stdout) => { if (error) fail(); else resolve(stdout); });
      child.stdin?.on("error", () => {});
      child.stdin?.end(options.input ?? "");
    } catch { fail(); }
  });
}

export function dockerEnvironment(env: Readonly<Record<string, string | undefined>>): NodeJS.ProcessEnv {
  return { PATH: env.PATH, HOME: env.HOME, DOCKER_CONFIG: env.DOCKER_CONFIG,
    // No ambient Compose/cutover/env values, DOCKER_HOST, app keys, or tokens.
    LANG: "C.UTF-8", NODE_ENV: "production" };
}
