import { describe, expect, it } from "vitest";
import {
  applyRememberedApplicationAnswers,
  rememberReviewedApplicationAnswers,
} from "@/lib/workspace/answer-memory";
import { buildRunnerFacts } from "@/lib/application-runner/types";
import { screeningAnswer } from "@/lib/application-runner/field-mapping";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";

describe("application answer memory", () => {
  it("remembers reviewed reusable answers and fills a later equivalent question", () => {
    const profile = rememberReviewedApplicationAnswers(
      SAMPLE_CONTRACTOR_PROFILE,
      [{
        id: "notice",
        label: "Please provide your notice period",
        answer: "Two weeks",
        required: true,
        source: "user",
        reviewed: true,
      }],
      "2026-08-25T10:00:00.000Z",
    );
    const questions = applyRememberedApplicationAnswers(
      [{
        id: "notice-new",
        label: "Provide your notice period",
        answer: "",
        required: true,
        source: "user",
        reviewed: false,
      }],
      profile.savedApplicationAnswers,
    );
    expect(questions[0]).toMatchObject({
      answer: "Two weeks",
      source: "profile",
      reviewed: true,
    });
  });

  it("does not remember security, consent or declaration answers", () => {
    const profile = rememberReviewedApplicationAnswers(
      { ...SAMPLE_CONTRACTOR_PROFILE, savedApplicationAnswers: [] },
      [
        { id: "code", label: "Verification code", answer: "123456", required: true, source: "user", reviewed: true },
        { id: "terms", label: "I consent to the employer terms", answer: "Yes", required: true, source: "user", reviewed: true },
        { id: "conviction", label: "Do you have a criminal conviction to declare?", answer: "No", required: true, source: "user", reviewed: true },
      ],
    );
    expect(profile.savedApplicationAnswers).toEqual([]);
  });

  it("makes remembered answers available to a newly discovered ATS field", () => {
    const candidate = {
      ...SAMPLE_CONTRACTOR_PROFILE,
      savedApplicationAnswers: [{
        id: "contract-length",
        label: "What contract length are you seeking?",
        answer: "Six months or longer",
        updatedAt: "2026-08-25T10:00:00.000Z",
      }],
    };
    const facts = buildRunnerFacts(candidate, []);
    expect(screeningAnswer({
      id: "field",
      index: 0,
      type: "text",
      label: "What contract length are you seeking?",
      name: "contract_length",
      placeholder: "",
      required: true,
      options: [],
      optionValue: "",
      optionLabel: "",
    }, facts)).toBe("Six months or longer");
  });
});
