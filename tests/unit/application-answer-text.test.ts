import { describe, expect, it } from "vitest";
import { evidenceForSkillQuestion, fitAnswerToLimit } from "@/lib/workspace/answer-text";
import { lengthSafeFieldValue, screeningAnswer } from "@/lib/application-runner/field-mapping";
import { buildScreeningQuestions } from "@/lib/workspace/engine";
import { buildRunnerFacts, type RunnerField } from "@/lib/application-runner/types";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { applyRememberedApplicationAnswers } from "@/lib/workspace/answer-memory";

const aws = "Built AWS infrastructure using Terraform and EKS.";
const azure = "Operated Azure (AKS, Key Vault and Monitor) for product teams.";
const cv = `Alex Morgan\nSKILLS\nAWS (EKS, IAM), Azure (AKS, Key Vault), Terraform\nEXPERIENCE\n${aws} ${azure}`;
const field = (overrides: Partial<RunnerField> = {}): RunnerField => ({ id: "q", index: 0, type: "textarea",
  label: "Describe your AWS experience", name: "aws", placeholder: "", required: true,
  options: [], optionValue: "", optionLabel: "", ...overrides });

describe("question-specific, length-safe answers", () => {
  it("selects different evidence for AWS and Azure even on the same CV line", () => {
    expect(evidenceForSkillQuestion(cv, "AWS")).toBe(aws);
    expect(evidenceForSkillQuestion(cv, "Azure")).toBe(azure);
    const questions = buildScreeningQuestions({ ...DEMO_JOBS[0], skills: ["AWS", "Azure"] }, SAMPLE_CONTRACTOR_PROFILE, cv);
    expect(questions.find(q => q.id.endsWith("-aws"))?.answer).toBe(aws);
    expect(questions.find(q => q.id.endsWith("-azure"))?.answer).toBe(azure);
    expect(evidenceForSkillQuestion(cv, "GCP")).toBe("");
    expect(evidenceForSkillQuestion("AWS (EKS, IAM), Azure (AKS, Key Vault), Terraform", "AWS")).toBe("");
  });
  it("never slices the reported Azure (AKS, fragment", () => {
    const limit = `${aws} Operated Azure (AKS,`.length;
    expect(fitAnswerToLimit(`${aws} ${azure}`, limit)).toBe(aws);
    expect(fitAnswerToLimit(azure, "Operated Azure (AKS,".length)).toBe("");
  });
  it("does not truncate before matching, or borrow another skill's shorter sentence", () => {
    expect(evidenceForSkillQuestion(`${"Detailed project history ".repeat(50)}. ${azure}`, "Azure")).toBe(azure);
    expect(evidenceForSkillQuestion(`${aws} ${azure}`, "Azure", 20)).toBe("");
  });
  it("keeps an unpunctuated answer only when it fits in full", () => {
    expect(fitAnswerToLimit("Two weeks", 9)).toBe("Two weeks");
    expect(fitAnswerToLimit("Two weeks", 8)).toBe("");
    expect(fitAnswerToLimit("Built AWS systems without an ending", 20)).toBe("");
  });
  it("preserves abbreviations, parentheses and Unicode instead of cutting characters", () => {
    const first = "Used Azure (AKS, Key Vault).";
    expect(fitAnswerToLimit(`${first} Built resilient systems.`, first.length)).toBe(first);
    expect(fitAnswerToLimit("Delivered £600/day work. Improved systems.", 26)).toBe("Delivered £600/day work.");
    expect(fitAnswerToLimit("A sentence (unfinished. More content.", 30)).toBe("");
  });
  it.each([0, -1, NaN, Infinity, 1.5])("fails closed when no complete answer fits the limit %s", max => {
    expect(fitAnswerToLimit(azure, max)).toBe("");
  });
  it("applies limits to narrative fields but never clips identity/contact facts", () => {
    expect(lengthSafeFieldValue(field({ maxLength: aws.length }), `${aws} ${azure}`)).toBe(aws);
    expect(lengthSafeFieldValue(field({ type: "email", maxLength: 8 }), "alex@example.test")).toBe("");
    expect(lengthSafeFieldValue(field(), azure)).toBe(azure);
    expect(lengthSafeFieldValue(field({ maxLength: 0 }), azure)).toBe("");
  });
  it("uses exact reviewed question identity, not a generic substring or another skill", () => {
    const questions = [
      { id: "aws", label: "Describe your AWS experience", answer: aws, required: true, reviewed: true, source: "user" as const },
      { id: "azure", label: "Describe your Azure experience", answer: azure, required: true, reviewed: false, source: "user" as const },
      { id: "generic", label: "Describe your experience", answer: "Unrelated saved statement.", required: true, reviewed: true, source: "user" as const },
    ];
    const facts = buildRunnerFacts(SAMPLE_CONTRACTOR_PROFILE, questions);
    expect(screeningAnswer(field(), facts)).toBe(aws);
    expect(screeningAnswer(field({ label: "Describe your Azure experience" }), facts)).toBe("");
    expect(screeningAnswer(field({ label: "Describe your experience with GCP" }), facts)).toBe("");
    expect(screeningAnswer(field(), { ...facts, screeningAnswers: [questions[0], { ...questions[0], answer: "Conflicting statement." }] })).toBe("");
  });
  it("does not collapse C, C# and C++ into the same remembered question", () => {
    const question = { id: "csharp", label: "Describe your C# experience", answer: "Delivered C# APIs.", required: true, reviewed: true, source: "user" as const };
    const facts = buildRunnerFacts(SAMPLE_CONTRACTOR_PROFILE, [question]);
    expect(screeningAnswer(field({ label: "Describe your C++ experience" }), facts)).toBe("");
    expect(screeningAnswer(field({ label: "Describe your C experience" }), facts)).toBe("");
    expect(screeningAnswer(field({ label: "Please describe your C# experience" }), facts)).toBe(question.answer);
    expect(applyRememberedApplicationAnswers([{ ...question, label: "Describe your C++ experience", answer: "", reviewed: false }],
      [{ ...question, updatedAt: new Date().toISOString() }])[0].answer).toBe("");
  });
});
