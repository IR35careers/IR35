import { describe, expect, it } from "vitest";
import {
  appendEmailActionLinks,
  extractEmailActionLink,
  extractEmailActionLinksFromHtml,
} from "@/lib/email/action-link";

describe("employer email action links", () => {
  it("extracts a password-reset link while ignoring footer links", () => {
    const html = `
      <p>Reset your password to continue your application.</p>
      <a href="https://careers.example.com/account/reset?token=abc123">Reset password</a>
      <a href="https://careers.example.com/privacy">Privacy</a>
      <a href="https://careers.example.com/unsubscribe?id=1">Unsubscribe</a>`;
    expect(extractEmailActionLinksFromHtml(html)).toEqual([
      "https://careers.example.com/account/reset?token=abc123",
    ]);
  });

  it("preserves an HTML-only action URL in the normalised text", () => {
    const text = appendEmailActionLinks(
      "Confirm your candidate account.",
      '<a href="https://auth.example.com/verify?token=secure">Confirm account</a>',
    );
    expect(text).toContain("https://auth.example.com/verify?token=secure");
    expect(extractEmailActionLink("Confirm your account", text)).toBe(
      "https://auth.example.com/verify?token=secure",
    );
  });

  it("rejects non-HTTPS, unsubscribe and unrelated links", () => {
    expect(
      extractEmailActionLink(
        "Company newsletter",
        "Read more https://example.com/news",
      ),
    ).toBeNull();
    expect(
      extractEmailActionLink(
        "Reset password",
        "https://example.com/unsubscribe?token=abc",
      ),
    ).toBeNull();
    expect(
      extractEmailActionLinksFromHtml(
        '<a href="http://127.0.0.1/reset?token=abc">Reset password</a>',
      ),
    ).toEqual([]);
  });
});
