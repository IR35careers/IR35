import { afterEach, describe, expect, it, vi } from "vitest";
import { submissionProviderConfig, submitWithProvider } from "@/lib/application-submission";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("application submission provider", () => {
  it("requires an explicit flag, HTTPS endpoint and server key", () => {
    vi.stubEnv("ENABLE_APPLICATION_SUBMISSION", "true");
    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_URL", "http://provider.example.test/submit");
    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_API_KEY", "secret");
    expect(submissionProviderConfig()).toBeNull();

    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_URL", "https://provider.example.test/submit");
    expect(submissionProviderConfig()).toMatchObject({ endpoint: "https://provider.example.test/submit", name: "Authorised submission provider" });
  });

  it("sends one idempotent approved packet and requires a provider receipt", async () => {
    vi.stubEnv("ENABLE_APPLICATION_SUBMISSION", "true");
    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_URL", "https://provider.example.test/submit");
    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_API_KEY", "secret");
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ submission_id: "receipt-123", submitted_at: "2026-08-20T10:00:00.000Z" }), { status: 201, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const receipt = await submitWithProvider({
      applicationId: "11111111-1111-4111-8111-111111111111",
      destination: "https://employer.example.test/apply",
      job: DEMO_JOBS[0],
      candidate: {
        fullName: "Alex Morgan", email: "alex@example.test", phone: "", location: "London", linkedInUrl: "", portfolioUrl: "", rightToWork: "yes", availability: "Now", noticePeriod: "", limitedCompanyName: "", companyNumber: "", vatRegistered: false, clearance: "", defaultCvLabel: "CV", forwardingEmail: "alex@example.test",
      },
      resume: { label: "CV", text: "Approved CV evidence" },
      coverLetter: "Approved cover letter",
      screeningAnswers: [],
    }, "submit:application-1");

    expect(receipt.providerSubmissionId).toBe("receipt-123");
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.headers).toMatchObject({ "idempotency-key": "submit:application-1" });
  });

  it("submits a complete candidate through the managed one-click API", async () => {
    vi.stubEnv("ENABLE_APPLICATION_SUBMISSION", "true");
    vi.stubEnv("TSENTA_API_KEY", "sk_live_test");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ profile_id: "prof_test" }), { status: 201, headers: { "Content-Type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "app_test", status: "submitted", updated_at: "2026-08-20T10:00:00.000Z" }), { status: 202, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    expect(submissionProviderConfig()).toMatchObject({ kind: "tsenta", endpoint: "https://api.autojobs.me/v1/" });
    const receipt = await submitWithProvider({
      applicationId: "11111111-1111-4111-8111-111111111111",
      destination: "https://jobs.ashbyhq.com/example/role",
      job: DEMO_JOBS[0],
      candidate: SAMPLE_CONTRACTOR_PROFILE,
      resume: { label: "CV", text: "Approved CV evidence", url: "https://example.test/signed-resume.pdf" },
      coverLetter: "Approved cover letter",
      screeningAnswers: [],
    }, "submit:application-2");

    expect(receipt).toMatchObject({ state: "submitted", providerSubmissionId: "app_test" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0].toString()).toBe("https://api.autojobs.me/v1/candidates");
    expect(fetchMock.mock.calls[1][0].toString()).toBe("https://api.autojobs.me/v1/applications");
  });
});
