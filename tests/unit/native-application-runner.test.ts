import { describe, expect, it } from "vitest";
import { detectAts } from "@/lib/application-runner/ats";
import { closestOption, deterministicMapping, screeningAnswer } from "@/lib/application-runner/field-mapping";
import { buildRunnerFacts, type RunnerField } from "@/lib/application-runner/types";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";

function field(overrides: Partial<RunnerField>): RunnerField {
  return {
    id: "field_1",
    index: 0,
    type: "text",
    label: "",
    name: "",
    placeholder: "",
    required: true,
    options: [],
    optionValue: "",
    optionLabel: "",
    ...overrides,
  };
}

describe("native application runner", () => {
  it("detects common ATS destinations without relying on a third-party submission API", () => {
    expect(detectAts("https://boards.greenhouse.io/company/jobs/1").kind).toBe("greenhouse");
    expect(detectAts("https://jobs.lever.co/company/role").kind).toBe("lever");
    expect(detectAts("https://jobs.ashbyhq.com/company/role").kind).toBe("ashby");
    expect(detectAts("https://careers.example.com/role").kind).toBe("generic");
  });

  it("maps normal identity and work-authorisation fields deterministically", () => {
    expect(deterministicMapping(field({ label: "First name" }))).toMatchObject({ factKey: "first_name" });
    expect(deterministicMapping(field({ label: "Will you now or in future require visa sponsorship?" }))).toMatchObject({ factKey: "needs_sponsorship" });
    expect(deterministicMapping(field({ label: "Date of birth" }))).toMatchObject({ factKey: "needs_user" });
  });

  it("uses only confirmed saved answers for employer-specific questions", () => {
    const facts = buildRunnerFacts(SAMPLE_CONTRACTOR_PROFILE, [{ id: "q1", label: "What is your notice period?", answer: "Two weeks", required: true, source: "user", reviewed: true }]);
    expect(screeningAnswer(field({ label: "What is your notice period?" }), facts)).toBe("Two weeks");
    expect(facts.values.email).toBe(SAMPLE_CONTRACTOR_PROFILE.email);
  });

  it("matches yes and no choices without guessing unrelated options", () => {
    expect(closestOption("Yes", ["Please select", "Yes", "No"])).toBe("Yes");
    expect(closestOption("No", ["I require sponsorship", "I do not require sponsorship"])).toBe("");
  });
});
