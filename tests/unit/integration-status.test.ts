import { afterEach, describe, expect, it, vi } from "vitest";
import { getIntegrationStatuses } from "@/lib/integration-status";

afterEach(() => vi.unstubAllEnvs());

describe("integration status", () => {
  it("requires every email gate before reporting a connection", () => {
    vi.stubEnv("ENABLE_INBOUND_MAIL", "true");
    vi.stubEnv("EMAIL_PROVIDER_API_KEY", "test-secret");
    vi.stubEnv("INBOUND_MAIL_SIGNING_SECRET", "");
    expect(getIntegrationStatuses().find((item) => item.id === "inbound_email")?.state).toBe("provider_gate");

    vi.stubEnv("INBOUND_MAIL_SIGNING_SECRET", "test-signing-secret");
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "apply.example.com");
    expect(getIntegrationStatuses().find((item) => item.id === "inbound_email")?.state).toBe("connected");
  });

  it("keeps live submission gated until every server-side value exists", () => {
    vi.stubEnv("ENABLE_APPLICATION_SUBMISSION", "true");
    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_URL", "https://provider.example.test/submit");
    expect(getIntegrationStatuses().find((item) => item.id === "ats_submission")?.state).toBe("provider_gate");

    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_API_KEY", "test-secret");
    expect(getIntegrationStatuses().find((item) => item.id === "ats_submission")?.state).toBe("connected");
  });

  it("returns capability state without returning credential values", () => {
    vi.stubEnv("REED_API_KEY", "do-not-expose-this-value");
    const serialized = JSON.stringify(getIntegrationStatuses());
    expect(serialized).not.toContain("do-not-expose-this-value");
    expect(getIntegrationStatuses().find((item) => item.id === "reed")?.state).toBe("connected");
  });
});
