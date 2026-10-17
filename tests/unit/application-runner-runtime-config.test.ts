import { describe, expect, it } from "vitest";
import {
  applicationRunnerHeadless,
  applicationRunnerWindowArgs,
} from "@/lib/application-runner/runtime-config";

describe("application runner browser mode", () => {
  it("keeps hosted Chromium headless", () => {
    expect(
      applicationRunnerHeadless({
        configured: "false",
        hasCustomExecutable: false,
      }),
    ).toBe(true);
  });

  it("allows the interactive persistent worker to run off screen", () => {
    expect(
      applicationRunnerHeadless({
        configured: "false",
        hasCustomExecutable: true,
      }),
    ).toBe(false);
    expect(applicationRunnerWindowArgs(false)).toEqual([
      "--window-position=-32000,-32000",
      "--window-size=1440,1000",
    ]);
  });
});
