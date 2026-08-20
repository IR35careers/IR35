import { describe, expect, it } from "vitest";
import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import { DEMO_JOBS } from "@/lib/demo-jobs";

describe("local role tailoring", () => {
  it("returns reviewable suggestions without inventing missing experience", () => {
    const cv = `Alex Morgan
alex@example.test

PROFILE
Platform engineer with AWS delivery experience.

EXPERIENCE
- I was responsible for AWS platform support and recovery testing.
`;
    const result = buildLocalTailoringResult(cv, DEMO_JOBS[0]);
    expect(result.model).toBe("ir35careers-evidence-engine");
    expect(result.baseline.missingKeywords.length).toBeGreaterThan(0);
    expect(result.suggestions.every((suggestion) => cv.includes(suggestion.original))).toBe(true);
    expect(result.suggestions.some((suggestion) => suggestion.replacement.includes("Not found"))).toBe(false);
  });
});
