import { describe, expect, it } from "vitest";
import {
  buildApplicationDeliveryReport,
  classifyApplicationDelivery,
  readAllDeliveryRows,
} from "@/lib/application-delivery-status";

const nowMs = Date.parse("2026-10-13T12:00:00Z");
const approved = {
  id: "application-1",
  status: "ready",
  truth_approved: true,
  materials_approved: true,
  submission_approved: true,
  screening_answers: [],
  job_snapshot: {
    id: "job-1",
    title: "Platform Engineer",
    company_name: "Employer",
    apply_url: "https://employer.example/apply?candidate=private@example.com",
    source_domain: "jobs.example",
  },
};
const confirmedSubmission = {
  id: "submission-1",
  application_id: approved.id,
  status: "succeeded",
  provider_name: "IR35Careers application runner",
  provider_submission_id: "native-123",
  submitted_at: "2026-10-13T11:55:00Z",
  receipt: {
    receiptId: "native-123",
    mode: "external_handoff",
    createdAt: "2026-10-13T11:55:00Z",
    destination: approved.job_snapshot.apply_url,
    message: "Thank you, Private Contractor, private@example.com +447123456789",
  },
};

describe("production application delivery evidence", () => {
  it("does not confuse a queued or paused application with employer submission", () => {
    const report = buildApplicationDeliveryReport({
      packets: [approved, { ...approved, id: "application-2" }],
      submissions: [{ ...confirmedSubmission, status: "processing", receipt: { state: "needs_user", action: "captcha" } }],
      tasks: [
        { id: "task-1", application_id: approved.id, status: "needs_user" },
        { id: "task-2", application_id: "application-2", status: "queued" },
      ],
      nowMs,
    });
    expect(report.totalApplications).toBe(2);
    expect(report.confirmedByProvider).toBe(0);
    expect(report.counts.needs_user).toBe(1);
    expect(report.counts.queued).toBe(1);
    expect(report.needsUserByAction).toEqual({ captcha: 1 });
  });

  it("separates portal confirmation, email dispatch acceptance, and contractor testimony", () => {
    const rows = [
      confirmedSubmission,
      { ...confirmedSubmission, provider_name: "Verified employer email" },
      { ...confirmedSubmission, provider_name: "Contractor employer-page confirmation", provider_submission_id: "contractor-confirmed-123" },
    ].map((submission) => classifyApplicationDelivery({ applicationId: approved.id, packet: approved, submission, nowMs }));
    expect(rows.map((row) => row.state)).toEqual([
      "employer_portal_confirmed", "employer_email_dispatched", "contractor_confirmed",
    ]);
    expect(rows[1].message).toContain("inbox delivery is not independently confirmed");
  });

  it("requires dated receipt evidence before treating a success flag as confirmed", () => {
    expect(classifyApplicationDelivery({
      applicationId: approved.id,
      packet: { ...approved, status: "applied", mode: "external_handoff" },
      submission: { status: "succeeded", provider_submission_id: "some-id" },
      nowMs,
    }).state).toBe("succeeded_without_receipt");
    expect(classifyApplicationDelivery({
      applicationId: approved.id,
      packet: { ...approved, status: "applied", mode: "dry_run" },
      nowMs,
    }).state).toBe("approved_without_submission");
  });

  it("does not count duplicate attempts twice or let an old task overwrite success", () => {
    const report = buildApplicationDeliveryReport({
      packets: [approved],
      submissions: [
        { ...confirmedSubmission, id: "old-submission", status: "processing", updated_at: "2026-10-13T11:00:00Z", receipt: { state: "needs_user" } },
        { ...confirmedSubmission, updated_at: "2026-10-13T11:55:00Z" },
      ],
      tasks: [{ application_id: approved.id, status: "cancelled" }],
      nowMs,
    });
    expect(report.totalApplications).toBe(1);
    expect(report.inspectedRows.submissions).toBe(2);
    expect(report.counts.employer_portal_confirmed).toBe(1);
  });

  it("keeps drafts, missing required answers, and expired worker leases actionable", () => {
    const report = buildApplicationDeliveryReport({
      packets: [
        { ...approved, id: "draft", status: "draft", submission_approved: false },
        { ...approved, id: "answer", screening_answers: [{ required: true, reviewed: false, answer: "" }] },
        { ...approved, id: "lease" },
      ],
      submissions: [],
      tasks: [{ application_id: "lease", status: "running", lease_expires_at: "2026-10-13T11:59:00Z" }],
      nowMs,
    });
    expect(report.counts.draft).toBe(1);
    expect(report.counts.approval_required).toBe(1);
    expect(report.counts.worker_lease_expired).toBe(1);
    expect(report.rows.find((row) => row.applicationId === "answer")?.approvals.requiredAnswersMissing).toBe(1);
  });

  it("returns only routing hosts and controlled messages without candidate material", () => {
    const row = classifyApplicationDelivery({
      applicationId: approved.id,
      packet: {
        ...approved,
        user_id: "candidate-user-id",
        source_cv_text: "Private Contractor Resume",
        screening_answers: [{ required: true, reviewed: true, answer: "private@example.com" }],
      },
      submission: confirmedSubmission,
      task: { destination: approved.job_snapshot.apply_url, last_error: "Private Contractor private@example.com" },
      nowMs,
    });
    const output = JSON.stringify(row);
    expect(output).not.toContain("private@example.com");
    expect(output).not.toContain("Private Contractor");
    expect(output).not.toContain("candidate-user-id");
    expect(output).not.toContain("?candidate=");
    expect(row.applyHost).toBe("employer.example");
  });
});

describe("complete production report pagination", () => {
  it("reads beyond default database response limits before reporting totals", async () => {
    const records = Array.from({ length: 1_203 }, (_, id) => ({ id: String(id) }));
    const pages: number[] = [];
    const result = await readAllDeliveryRows(async (from, to) => {
      pages.push(from);
      return { data: records.slice(from, to + 1), error: null };
    });
    expect(result).toHaveLength(1_203);
    expect(pages).toEqual([0, 500, 1_000]);
  });

  it("rejects incomplete scans instead of returning plausible partial totals", async () => {
    await expect(readAllDeliveryRows(async (from) => ({
      data: from === 0 ? Array.from({ length: 500 }, (_, id) => ({ id })) : null,
      error: from === 0 ? null : new Error("Database read failed"),
    }))).rejects.toThrow("Database read failed");
  });
});
