import { afterEach, describe, expect, it, vi } from "vitest";
import { renderWelcomeEmail } from "@/lib/email/templates";
import { transactionalEmailConfig } from "@/lib/email/transactional";

afterEach(() => vi.unstubAllEnvs());

describe("transactional email", () => {
  it("renders a responsive, branded welcome message with a plain-text alternative", () => {
    const email = renderWelcomeEmail({
      firstName: "Anvesh",
      logoSource: "cid:ir35careers-mark",
      siteUrl: "https://www.ir35careers.com/",
    });

    expect(email.subject).toContain("Welcome to IR35Careers");
    expect(email.html).toContain("Welcome, Anvesh.");
    expect(email.html).toContain('src="cid:ir35careers-mark"');
    expect(email.html).toContain("https://www.ir35careers.com/onboarding");
    expect(email.html).toContain("truth-preserving");
    expect(email.html).toContain("The IR35Careers Team");
    expect(email.text).toContain("Set up your contractor profile");
    expect(email.text).toContain("not legal or tax advice");
  });

  it("escapes untrusted profile names and falls back to the production site", () => {
    const email = renderWelcomeEmail({
      firstName: '<img src=x onerror="alert(1)">',
      siteUrl: "javascript:alert(1)",
    });

    expect(email.html).not.toContain("<img src=x");
    expect(email.html).toContain("&lt;img");
    expect(email.html).toContain("https://www.ir35careers.com/onboarding");
  });

  it("keeps delivery disabled unless the provider flag and credentials are valid", () => {
    vi.stubEnv("ENABLE_WELCOME_EMAIL", "false");
    vi.stubEnv("RESEND_API_KEY", "re_test-key");
    expect(transactionalEmailConfig()).toBeNull();

    vi.stubEnv("ENABLE_WELCOME_EMAIL", "true");
    vi.stubEnv("EMAIL_FROM", "IR35Careers <welcome@mail.ir35careers.com>");
    vi.stubEnv("EMAIL_REPLY_TO", "support@example.com");
    expect(transactionalEmailConfig()).toEqual({
      apiKey: "re_test-key",
      from: "IR35Careers <welcome@mail.ir35careers.com>",
      replyTo: "support@example.com",
    });

    vi.stubEnv("EMAIL_REPLY_TO", "not-an-email");
    expect(transactionalEmailConfig()).toBeNull();
  });
});

