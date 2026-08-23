import { describe, expect, it } from "vitest";
import {
  applicationNotificationPresentation,
  buildApplicationInboxRecord,
  type ApplicationNotificationInput,
} from "@/lib/email/application-notifications";

const base: ApplicationNotificationInput = {
  kind: "needs_attention",
  to: "candidate@example.com",
  userId: "11111111-1111-4111-8111-111111111111",
  inboxAlias: "apply-test@mail.ir35careers.com",
  jobTitle: "Senior Data Scientist",
  companyName: "Michael Page Technology",
  jobId: "33333333-3333-4333-8333-333333333333",
  applicationId: "22222222-2222-4222-8222-222222222222",
  idempotencyKey: "submit:test:needs-user",
  occurredAt: "2026-08-21T22:44:00.000Z",
};

describe("application notifications", () => {
  it("stores a needs-attention notification in the candidate inbox", () => {
    const record = buildApplicationInboxRecord(base);
    expect(record).toMatchObject({
      user_id: base.userId,
      application_id: base.applicationId,
      sender: "IR35Careers",
      recipient: base.inboxAlias,
      subject: "Your answer is needed: Senior Data Scientist at Michael Page Technology",
      classification: "action_required",
      is_read: false,
      received_at: base.occurredAt,
    });
    expect(record?.provider_message_id).toMatch(/^ir35-system-[a-f0-9]{64}$/);
  });

  it("uses a deterministic provider id so retries cannot duplicate a message", () => {
    expect(buildApplicationInboxRecord(base)?.provider_message_id).toBe(buildApplicationInboxRecord(base)?.provider_message_id);
  });

  it("sends action links to the exact job workspace", () => {
    expect(applicationNotificationPresentation(base).actionPath).toBe(
      `/applications/new/${base.jobId}#needs-attention`,
    );
    expect(
      applicationNotificationPresentation({
        ...base,
        kind: "submission_issue",
      }).actionPath,
    ).toBe(`/applications/new/${base.jobId}#needs-attention`);
  });

  it("presents an unverified linked email without calling it a recruiter reply", () => {
    expect(
      applicationNotificationPresentation({ ...base, kind: "message" }),
    ).toMatchObject({
      title: "A new application message has arrived",
      actionPath: "/inbox",
    });
  });

  it("treats an infrastructure retry as an update, not missing user information", () => {
    const record = buildApplicationInboxRecord({
      ...base,
      kind: "submission_issue",
    });
    expect(record).toMatchObject({
      subject:
        "Application ready to retry: Senior Data Scientist at Michael Page Technology",
      classification: "application_update",
    });
  });

  it("does not create an inbox record without a trusted user id", () => {
    expect(buildApplicationInboxRecord({ ...base, userId: undefined })).toBeNull();
  });
});
