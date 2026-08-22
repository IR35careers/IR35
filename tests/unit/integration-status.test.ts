import { afterEach, describe, expect, it, vi } from "vitest";
import { getIntegrationStatuses } from "@/lib/integration-status";

afterEach(() => vi.unstubAllEnvs());

describe("integration status", () => {
  it("requires every email gate before reporting a connection", () => {
    vi.stubEnv("ENABLE_INBOUND_MAIL", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test-secret");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "");
    expect(getIntegrationStatuses().find((item) => item.id === "inbound_email")?.state).toBe("provider_gate");

    vi.stubEnv("RESEND_WEBHOOK_SECRET", "whsec_test-signing-secret");
    vi.stubEnv("INBOUND_EMAIL_DOMAIN", "apply.example.com");
    expect(getIntegrationStatuses().find((item) => item.id === "inbound_email")?.state).toBe("connected");
  });

  it("uses the owned runner without requiring an external gateway key", () => {
    vi.stubEnv("ENABLE_APPLICATION_SUBMISSION", "true");
    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_URL", "https://provider.example.test/submit");
    expect(getIntegrationStatuses().find((item) => item.id === "ats_submission")?.state).toBe("connected");

    vi.stubEnv("APPLICATION_SUBMISSION_PROVIDER_API_KEY", "test-secret");
    expect(getIntegrationStatuses().find((item) => item.id === "ats_submission")?.state).toBe("connected");
  });

  it("reports the persistent worker only with a signed HTTPS connection", () => {
    vi.stubEnv("APPLICATION_WORKER_ENABLED", "true");
    vi.stubEnv("APPLICATION_WORKER_URL", "https://worker.ir35careers.com");
    vi.stubEnv("APPLICATION_WORKER_SECRET", "worker-test-secret-that-is-long-enough-123");
    expect(getIntegrationStatuses({ includeOperations: true }).find((item) => item.id === "persistent_worker")?.state).toBe("connected");
    expect(getIntegrationStatuses().find((item) => item.id === "persistent_worker")).toBeUndefined();

    vi.stubEnv("APPLICATION_WORKER_URL", "http://worker.ir35careers.com");
    expect(getIntegrationStatuses({ includeOperations: true }).find((item) => item.id === "persistent_worker")?.state).toBe("provider_gate");
    expect(JSON.stringify(getIntegrationStatuses())).not.toContain("worker-test-secret");
  });

  it("recognises the managed one-click application key without exposing it", () => {
    vi.stubEnv("ENABLE_APPLICATION_SUBMISSION", "true");
    vi.stubEnv("TSENTA_API_KEY", "sk_live_do-not-expose");
    expect(getIntegrationStatuses().find((item) => item.id === "ats_submission")?.state).toBe("connected");
    expect(JSON.stringify(getIntegrationStatuses())).not.toContain("sk_live_do-not-expose");
  });

  it("reports AI tailoring only when a server-side OpenRouter key exists", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(getIntegrationStatuses().find((item) => item.id === "ai_tailoring")?.state).toBe("provider_gate");
    vi.stubEnv("OPENROUTER_API_KEY", "server-only-test-key");
    expect(getIntegrationStatuses().find((item) => item.id === "ai_tailoring")?.state).toBe("connected");
    expect(JSON.stringify(getIntegrationStatuses())).not.toContain("server-only-test-key");
  });

  it("returns capability state without returning credential values", () => {
    vi.stubEnv("REED_API_KEY", "do-not-expose-this-value");
    const serialized = JSON.stringify(getIntegrationStatuses());
    expect(serialized).not.toContain("do-not-expose-this-value");
    expect(getIntegrationStatuses().find((item) => item.id === "reed")?.state).toBe("connected");
  });
});
