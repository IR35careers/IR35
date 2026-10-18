import { describe, expect, it } from "vitest";
import { buildScreeningQuestions, buildTruthPreservingCoverLetter } from "@/lib/workspace/engine";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";

const job = { ...DEMO_JOBS[0], remote_type: "unknown" as const, ir35_status: "unknown" as const, location: "Unknown", company_name: "Not stated" };

describe("truthful unknown job values", () => {
  it("asks for confirmation without interpolating unknown placeholders or assuming attendance", () => {
    const questions = buildScreeningQuestions(job, { ...SAMPLE_CONTRACTOR_PROFILE, canWorkInPerson: true, workedForCompanyBefore: false });
    expect(questions.map(q => q.label).join(" ")).not.toMatch(/unknown|not stated|undetermined|unspecified|\btbc\b/i);
    expect(questions.find(q => q.id === "location")).toMatchObject({ answer: "", reviewed: false, source: "user", required: true });
    expect(questions.find(q => q.id === "previous-employer")).toMatchObject({ answer: "", reviewed: false, source: "user" });
  });
  it.each(["remote", "hybrid", "onsite"] as const)("retains known %s facts and omits an unstated location", remote_type => {
    const question = buildScreeningQuestions({ ...job, remote_type }, SAMPLE_CONTRACTOR_PROFILE).find(q => q.id === "location");
    expect(question?.label).toBe(`Can you meet the advertised ${remote_type === "onsite" ? "on-site" : remote_type} working pattern?`);
    expect(question?.reviewed).toBe(true);
  });
  it("does not turn a remembered answer into confirmation of another unknown role", () => {
    const question = buildScreeningQuestions(job, SAMPLE_CONTRACTOR_PROFILE).find(q => q.id === "location")!;
    const profile = { ...SAMPLE_CONTRACTOR_PROFILE, savedApplicationAnswers: [{ id: "old", label: question.label, answer: "Yes", updatedAt: new Date().toISOString() }] };
    expect(buildScreeningQuestions(job, profile).find(q => q.id === "location")).toMatchObject({ answer: "", reviewed: false });
  });
  it("requests missing contract facts in the cover letter rather than claiming they are advertised", () => {
    const letter = buildTruthPreservingCoverLetter(job, SAMPLE_CONTRACTOR_PROFILE, ["AWS"]);
    expect(letter).toContain("Please confirm the IR35 status and working pattern before engagement.");
    expect(letter).not.toMatch(/unknown working pattern|advertised.*unknown|arrangement.*understood/);
    const known = buildTruthPreservingCoverLetter({ ...job, remote_type: "hybrid", ir35_status: "outside" }, SAMPLE_CONTRACTOR_PROFILE, ["AWS"]);
    expect(known).toContain("advertised Outside IR35 arrangement and hybrid working pattern");
  });
});
