import { describe, expect, it } from "vitest";
import { approvedApplicationPacketRow, InvalidApplicationPacketError, normaliseApprovedApplicationPacket } from "@/lib/application-packet-snapshot";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import type { ApplicationRecord } from "@/lib/workspace/types";

const APPLICATION_ID = "11111111-1111-4111-8111-111111111111";

function packet(overrides: Partial<ApplicationRecord> = {}): ApplicationRecord {
  return {
    id: APPLICATION_ID,
    job: { ...DEMO_JOBS[0], id: "22222222-2222-4222-8222-222222222222", apply_url: "https://employer.example.test/apply" },
    status: "ready",
    matchScore: 82,
    matchedKeywords: ["TypeScript"],
    missingKeywords: [],
    sourceCvText: "A truthful source Resume with sufficient evidence.",
    tailoredCvText: "A truthful tailored Resume with sufficient evidence.",
    resumeVersionLabel: "Platform Engineer Resume",
    coverLetter: "Dear Hiring Team,\n\nPlease consider my application.",
    questions: [{ id: "right_to_work", label: "Right to work in the UK?", answer: "Yes", required: true, source: "profile", reviewed: true }],
    truthApproved: true,
    materialsApproved: true,
    submissionApproved: true,
    mode: "dry_run",
    receipt: null,
    createdAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
    events: [],
    ...overrides,
  };
}

describe("approved application packet snapshot", () => {
  it("normalises an approved client packet for the authenticated server handoff", () => {
    const result = normaliseApprovedApplicationPacket(packet(), APPLICATION_ID, "2026-08-21T12:00:00.000Z");
    expect(result).toMatchObject({ id: APPLICATION_ID, status: "ready", mode: "dry_run", receipt: null, submissionApproved: true });
    expect(result.updatedAt).toBe("2026-08-21T12:00:00.000Z");
  });

  it("rejects incomplete approval and unanswered required employer questions", () => {
    expect(() => normaliseApprovedApplicationPacket(packet({ submissionApproved: false }), APPLICATION_ID)).toThrow(InvalidApplicationPacketError);
    expect(() => normaliseApprovedApplicationPacket(packet({
      questions: [{ id: "salary", label: "Salary expectation", answer: "", required: true, source: "job", reviewed: false }],
    }), APPLICATION_ID)).toThrow("Answer and review every required employer question");
  });

  it("rejects a different application id and insecure employer URL", () => {
    expect(() => normaliseApprovedApplicationPacket(packet(), "33333333-3333-4333-8333-333333333333")).toThrow(InvalidApplicationPacketError);
    expect(() => normaliseApprovedApplicationPacket(packet({ job: { ...packet().job, apply_url: "http://employer.example.test/apply" } }), APPLICATION_ID)).toThrow(InvalidApplicationPacketError);
  });

  it("builds an owner-bound database row with a server-trusted job", () => {
    const result = normaliseApprovedApplicationPacket(packet(), APPLICATION_ID);
    const trustedJob = { ...result.job, title: "Trusted job title", apply_url: "https://trusted.example.test/apply" };
    expect(approvedApplicationPacketRow(result, "user-123", trustedJob)).toMatchObject({
      id: APPLICATION_ID,
      user_id: "user-123",
      job_id: trustedJob.id,
      job_snapshot: trustedJob,
      status: "ready",
      submission_approved: true,
    });
  });
});
