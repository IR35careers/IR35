import { afterEach, describe, expect, it, vi } from "vitest";
import { renderBetaLaunchEmail, renderWelcomeEmail } from "@/lib/email/templates";
import { transactionalEmailConfig } from "@/lib/email/transactional";

afterEach(() => vi.unstubAllEnvs());

describe("transactional email", () => {
  it("renders a responsive, branded welcome message with a plain-text alternative", () => {
    const email = renderWelcomeEmail({
      firstName: "Anvesh",
      logoSource: "cid:ir35careers-mark",
      siteUrl: "https://www.ir35careers.com/",
    });

    expect(email.subject).toContain("Welcome to IR35Careers Beta");
    expect(email.html).toContain("Welcome, Anvesh.");
    expect(email.html).toContain('src="cid:ir35careers-mark"');
    expect(email.html).toContain('bgcolor="#effaf5"');
    expect(email.html).toContain("https://www.ir35careers.com/onboarding");
    expect(email.html).toContain("truth-preserving");
    expect(email.html).toContain("The IR35Careers Team");
    expect(email.text).toContain("Set up your contractor profile");
    expect(email.text).toContain("not legal or tax advice");
    expect(`${email.subject}${email.html}${email.text}`).not.toMatch(/[—→·]/);
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

  it("renders the one-time public-beta invitation without claiming an account already exists", () => {
    const email = renderBetaLaunchEmail({ logoSource: "cid:ir35careers-mark" });
    expect(email.subject).toBe("Your IR35Careers beta access is ready");
    expect(email.html).toContain("You joined the IR35Careers waitlist");
    expect(email.html).toContain('bgcolor="#effaf5"');
    expect(email.html).toContain("Create my free account");
    expect(email.html).toContain("ATS friendly improvements");
    expect(email.html).toContain("does not submit an application without your approval");
    expect(email.html).toContain("You have not been added to a marketing list");
    expect(email.html).not.toContain("Your account is ready");
    expect(email.text).toContain("one time service email");
    expect(email.text).toContain("YOU REMAIN IN CONTROL");
    expect(`${email.subject}${email.html}${email.text}`).not.toMatch(/[—→·]/);
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

  it("uses the verified branded sender when no override is supplied", () => {
    vi.stubEnv("ENABLE_WELCOME_EMAIL", "true");
    vi.stubEnv("RESEND_API_KEY", "re_test-key");
    vi.stubEnv("EMAIL_FROM", "");
    vi.stubEnv("EMAIL_REPLY_TO", "");
    expect(transactionalEmailConfig()?.from).toBe("IR35Careers <hello@mail.ir35careers.com>");
  });
});
