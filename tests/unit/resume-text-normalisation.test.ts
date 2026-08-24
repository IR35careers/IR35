import { describe, expect, it } from "vitest";
import { normaliseResumeText } from "@/lib/resume/normalise-text";

describe("resume text normalisation", () => {
  it("removes empty bullet markers while preserving real Resume bullets", () => {
    expect(
      normaliseResumeText(
        "Improved delivery pipelines.\n•\n•\n\n- Built CI/CD pipelines\n*\n• Reduced deployment failures",
      ),
    ).toBe(
      "Improved delivery pipelines.\n\n- Built CI/CD pipelines\n\n• Reduced deployment failures",
    );
  });

  it("removes a trailing block of empty bullets", () => {
    expect(normaliseResumeText("Delivered platform improvements.\n•\n•\n•"))
      .toBe("Delivered platform improvements.");
  });
});
