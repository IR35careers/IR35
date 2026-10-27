import { describe, expect, it } from "vitest";
import { mockWebPolicy, requireMockWebActor, MOCK_WEB_SCENARIOS, mockWebKickSchema,
  mockWebClaimSchema, mockWebAssignmentSchema, mockWebResultSchema } from "@/lib/queue/mock-web-policy";
import { STAGING_TEST_ACCOUNT } from "@/lib/queue/mock-config";

const ids = Array.from({ length: 6 }, (_, i) => `00000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`);
const env = { IR35_MOCK_WEB_ENABLED: "true", IR35_STAGING: "true", APPLY_RUNNER: "mock",
  APPLICATION_WORKER_ACCEPT_JOBS: "false", IR35_READ_ONLY: "false", APPLICATION_WORKER_CONCURRENCY: "1",
  IR35_SCHEDULER_ENABLED: "false",
  APPLICATION_WORKER_SECRET: "fixture-only-not-a-real-secret-0000000", IR35CAREERS_APP_URL: "https://staging.ir35careers.com",
  IR35_MOCK_WEB_JOB_IDS: ids.join(",") };
const actor = { accountEmail: STAGING_TEST_ACCOUNT, userId: ids[0]!, packetUserId: ids[0]!, applicationId: ids[1]!, jobId: ids[0]! };

describe("isolated frontend mock delivery boundary", () => {
  it("is disabled by default and never enables the real consumer", () => {
    expect(mockWebPolicy({})).toBeNull();
    expect(mockWebPolicy({ IR35_MOCK_WEB_ENABLED: "false" })).toBeNull();
    const policy = mockWebPolicy(env)!;
    expect(policy.jobIds.map(policy.scenarioFor)).toEqual([...MOCK_WEB_SCENARIOS]);
    expect(env.APPLICATION_WORKER_ACCEPT_JOBS).toBe("false");
  });
  it.each([
    { IR35_MOCK_WEB_ENABLED: "TRUE" }, { IR35_STAGING: "false" }, { APPLY_RUNNER: "oracle" },
    { APPLICATION_WORKER_ACCEPT_JOBS: "true" }, { IR35_READ_ONLY: "true" },
    { APPLICATION_WORKER_CONCURRENCY: "2" }, { VERCEL: "1" },
    { IR35_SCHEDULER_ENABLED: "true" },
    { IR35CAREERS_APP_URL: "https://www.ir35careers.com" },
    { RESEND_API_KEY: "fixture-secret-sentinel" }, { STRIPE_SECRET_KEY: "fixture-secret-sentinel" },
    { EMAIL_PROVIDER_API_KEY: "fixture-secret-sentinel" }, { TSENTA_API_KEY: "fixture-secret-sentinel" },
    { APPLICATION_SUBMISSION_PROVIDER_URL: "https://provider.invalid" }, { SMTP_PASS: "fixture-secret-sentinel" },
    { GOTRUE_EXTERNAL_GOOGLE_SECRET: "fixture-secret-sentinel" },
  ])("rejects unsafe fixture configuration without disclosing values %#", extra => {
    expect(() => mockWebPolicy({ ...env, ...extra })).toThrow("isolated, provider-free fixture");
    try { mockWebPolicy({ ...env, ...extra }); } catch (error) {
      expect(String(error)).not.toContain("fixture-secret-sentinel");
    }
  });
  it.each(["", ids.slice(0, 5).join(","), [...ids, ids[0]].join(","),
    [...ids.slice(0, 5), ids[0]].join(","), ["*", ...ids.slice(1)].join(","),
    ["AAAAAAAA-0000-4000-8000-000000000001", ...ids.slice(1)].join(",")])("requires exact unique fixture identifiers %#", value => {
    expect(() => mockWebPolicy({ ...env, IR35_MOCK_WEB_JOB_IDS: value })).toThrow();
  });
  it("requires the authenticated named actor, its packet owner and a server-owned job", () => {
    const policy = mockWebPolicy(env)!;
    expect(requireMockWebActor(policy, actor)).toEqual({ applicationId: ids[1], jobId: ids[0], scenario: "success" });
    for (const extra of [{ accountEmail: "customer@invalid.test" }, { packetUserId: ids[2] },
      { jobId: "10000000-0000-4000-8000-000000000001" }, { callbackUrl: "https://employer.invalid" }])
      expect(() => requireMockWebActor(policy, { ...actor, ...extra })).toThrow();
  });
  it("queues only opaque identifiers and rejects every personal/provider field", () => {
    const kick = { kind: "staging_web_mock_delivery", applicationId: ids[0], jobId: ids[1], deliveryVersion: 1, requestedAt: "2026-10-27T00:00:00.000Z" };
    expect(mockWebKickSchema.parse(kick)).toEqual(kick);
    expect(mockWebKickSchema.safeParse({ ...kick, deliveryVersion: 0 }).success).toBe(false);
    for (const field of ["email", "actorEmail", "password", "cv", "destination", "callbackUrl", "token", "scenario"])
      expect(mockWebKickSchema.safeParse({ ...kick, [field]: "fixture-private-sentinel" }).success).toBe(false);
  });
  it("bounds claims and assignments to mock IDs, one attempt and enumerated outcomes", () => {
    expect(mockWebClaimSchema.safeParse({ kind: "staging_web_mock_claim", applicationId: ids[0], jobId: ids[1],
      deliveryVersion: 1, workerId: `staging-web-mock-${ids[2]}` }).success).toBe(true);
    expect(mockWebClaimSchema.safeParse({ kind: "staging_web_mock_claim", applicationId: ids[0], jobId: ids[1],
      deliveryVersion: 1, workerId: `oracle-${ids[2]}` }).success).toBe(false);
    expect(mockWebAssignmentSchema.safeParse({ applicationId: ids[0], taskId: ids[1], attempt: 1, scenario: "success" }).success).toBe(true);
    expect(mockWebAssignmentSchema.safeParse({ applicationId: ids[0], taskId: ids[1], attempt: 0, scenario: "success" }).success).toBe(false);
  });
  it("never accepts an invented submitted receipt or a failure without a visible reason", () => {
    const result = { kind: "staging_web_mock_result", applicationId: ids[0], taskId: ids[1], attempt: 1,
      outcome: "submitted", failure: null, mockReceiptConfirmed: true };
    expect(mockWebResultSchema.safeParse(result).success).toBe(true);
    expect(mockWebResultSchema.safeParse({ ...result, outcome: "failed", failure: "mock_unknown_outcome", mockReceiptConfirmed: false }).success).toBe(true);
    for (const extra of [{ mockReceiptConfirmed: false }, { failure: "mock_unknown_outcome" },
      { outcome: "failed", mockReceiptConfirmed: false }, { destination: "https://real-employer.invalid" }])
      expect(mockWebResultSchema.safeParse({ ...result, ...extra }).success).toBe(false);
  });
});
