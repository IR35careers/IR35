import { describe, expect, it } from "vitest";
import { applicationSubmitBlockers, autoApplyActionBlockers } from "@/lib/workspace/action-blockers";
import { prepareApplication } from "@/lib/workspace/engine";
import { SAMPLE_CONTRACTOR_PROFILE, SAMPLE_CV_TEXT } from "@/lib/workspace/seed";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import type { ApplicationRecord, ContractorProfile } from "@/lib/workspace/types";

function ready(): ApplicationRecord {
  const application = prepareApplication({ job: DEMO_JOBS[0], profile: SAMPLE_CONTRACTOR_PROFILE, cvText: SAMPLE_CV_TEXT });
  return { ...application, deliveryStatus: "awaiting_approval", truthApproved: true, materialsApproved: true, submissionApproved: true,
    questions: application.questions.map(question => ({ ...question, answer: question.answer || "Controlled fixture.", reviewed: true })) };
}
function blockers(application = ready(), profile: ContractorProfile = SAMPLE_CONTRACTOR_PROFILE) {
  return applicationSubmitBlockers({ application, profile, busy: null, submissionInProgress: false });
}

describe("exact application submission blockers", () => {
  it("has no client blockers for reviewed facts without inventing employer or credit eligibility", () => {
    expect(blockers()).toEqual([]);
  });
  it("lists every missing or unreviewed required question by its real label, not optional questions", () => {
    const application = { ...ready(), questions: [
      { id: "aws", label: "Describe your AWS delivery", answer: "", required: true, reviewed: false, source: "profile" as const },
      { id: "azure", label: "Describe your Azure delivery", answer: "AKS delivery.", required: true, reviewed: false, source: "profile" as const },
      { id: "optional", label: "Optional detail", answer: "", required: false, reviewed: false, source: "profile" as const },
    ] };
    expect(blockers(application)).toEqual([
      { id: "answer:aws", message: "Answer “Describe your AWS delivery”.", targetId: "question-aws", actionLabel: "Review answer" },
      { id: "answer:azure", message: "Confirm your answer to “Describe your Azure delivery”.", targetId: "question-azure", actionLabel: "Review answer" },
    ]);
  });
  it("never accepts a reviewed but blank required answer", () => {
    const application = ready();
    application.questions = [{ id: "blank", label: "Required declaration", answer: "  ", required: true, reviewed: true, source: "profile" }];
    expect(blockers(application).map(item => item.id)).toEqual(["answer:blank"]);
  });
  it.each(["truthApproved", "materialsApproved", "submissionApproved"] as const)("explains the single final control if %s is missing", flag => {
    expect(blockers({ ...ready(), [flag]: false })).toEqual([{ id: "approval",
      message: "Approve this application to confirm the CV and answers and authorise submission.",
      actionLabel: "Review final approval", targetId: "application-final-approval" }]);
  });
  it("links only missing application essentials to their exact profile fields and saved job", () => {
    const result = blockers(ready(), { ...SAMPLE_CONTRACTOR_PROFILE, phone: "", email: "", forwardingEmail: "" });
    expect(result.map(item => item.id)).toEqual(["profile:phone", "profile:email"]);
    expect(result[0].href).toContain("focus=phone#application-readiness");
    expect(result[0].href).toContain(encodeURIComponent(`/applications/new/${DEMO_JOBS[0].id}?resume=profile#needs-attention`));
  });
  it("uses the same saved forwarding/account email fallback as the server gate", () => {
    const profile = { ...SAMPLE_CONTRACTOR_PROFILE, email: "", forwardingEmail: "" };
    expect(applicationSubmitBlockers({ application: ready(), profile, fallbackEmail: "anvesh.mannuru+ir35test@gmail.com", busy: null, submissionInProgress: false })).toEqual([]);
    expect(blockers(ready(), { ...profile, forwardingEmail: "controlled@example.test" })).toEqual([]);
  });
  it("explains an invalid technical heading used as a name even when it contains two words", () => {
    const application = { ...ready(), tailoredCvText: `Cloud Platforms\nRBAC, IAM\n${"Terraform, Kubernetes, Docker. ".repeat(10)}` };
    expect(blockers(application, { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Cloud Platforms" }).map(item => item.id))
      .toEqual(["profile:full-name"]);
  });
  it("explains missing CV text instead of requiring unrelated profile completion", () => {
    expect(blockers({ ...ready(), tailoredCvText: "Short CV", sourceCvText: "" })).toEqual([
      { id: "profile:cv", message: "Add a readable CV with at least 120 characters.", actionLabel: "Review application CV", targetId: "application-cv-text" },
    ]);
    expect(blockers(ready(), { ...SAMPLE_CONTRACTOR_PROFILE, isOver18: null, willingToTravel: null,
      addressLine1: "", skills: [], targetRole: "", backgroundCheckConsent: null })).toEqual([]);
  });
  it.each(["parse", "prepare", "ai", "save", "submit"] as const)("explains the %s busy state", busy => {
    expect(applicationSubmitBlockers({ application: ready(), profile: SAMPLE_CONTRACTOR_PROFILE, busy, submissionInProgress: false }))
      .toEqual([{ id: "busy", message: expect.stringMatching(/Wait|request is in progress/) }]);
  });
  it.each(["queued", "submitting"] as const)("explains %s without offering an edit or a second submission", deliveryStatus => {
    const application = { ...ready(), deliveryStatus, truthApproved: false };
    const result = applicationSubmitBlockers({ application, profile: SAMPLE_CONTRACTOR_PROFILE, busy: "submit", submissionInProgress: true });
    expect(result).toEqual([{ id: "in-flight", message: expect.stringContaining(deliveryStatus === "queued" ? "queued" : "being submitted") }]);
  });
  it("does not invite submission of a skipped application", () => {
    expect(blockers({ ...ready(), deliveryStatus: "skipped" }).map(item => item.id)).toEqual(["skipped"]);
  });
  it("does not mutate or approve the application while explaining it", () => {
    const application = ready();
    application.truthApproved = false;
    const before = structuredClone(application);
    blockers(application);
    expect(application).toEqual(before);
  });
});

describe("Auto Apply disabled-action explanations", () => {
  for (const busy of [null, "preview", "apply"] as const) for (const enabled of [false, true]) for (const consentAccepted of [false, true]) {
    it(`matches all actual gates: busy=${busy}, enabled=${enabled}, consent=${consentAccepted}`, () => {
      const result = autoApplyActionBlockers({ busy, enabled, consentAccepted });
      expect(result.map(item => item.id)).toEqual([
        ...(busy ? ["busy"] : []), ...(!enabled ? ["enabled"] : []), ...(!consentAccepted ? ["consent"] : []),
      ]);
      expect(result.length > 0).toBe(Boolean(busy || !enabled || !consentAccepted));
      if (!enabled) expect(result.find(item => item.id === "enabled")?.targetId).toBe("auto-apply-toggle");
      if (!consentAccepted) expect(result.find(item => item.id === "consent")?.targetId).toBe("auto-apply-consent");
    });
  }
});
