export function applicationRunnerHeadless(input: {
  configured?: string;
  hasCustomExecutable: boolean;
}): boolean {
  // Hosted Chromium has no desktop session, so it must always remain
  // headless. The persistent Windows worker can use its interactive desktop
  // when a job board rejects the headless browser transport.
  if (!input.hasCustomExecutable) return true;
  return !/^(?:0|false|no|off)$/i.test(input.configured?.trim() ?? "");
}

export function applicationRunnerWindowArgs(headless: boolean): string[] {
  return headless
    ? []
    : ["--window-position=-32000,-32000", "--window-size=1440,1000"];
}
