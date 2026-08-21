import { describe, expect, it } from "vitest";
import {
  emailCampaignTemplates,
  normaliseCampaignDraft,
  renderCampaignEmail,
  validateCampaignDraft,
} from "@/lib/email/campaigns";

describe("admin email campaigns", () => {
  it("provides editable professional templates", () => {
    expect(emailCampaignTemplates).toHaveLength(4);
    expect(emailCampaignTemplates.map((template) => template.templateId)).toEqual([
      "feature-update",
      "contractor-guide",
      "service-notice",
      "welcome-reminder",
    ]);
    for (const template of emailCampaignTemplates) {
      expect(() => validateCampaignDraft(template)).not.toThrow();
    }
  });

  it("renders escaped branded HTML and a plain text alternative", () => {
    const content = renderCampaignEmail({
      ...emailCampaignTemplates[0],
      heading: "A safer <script>alert(1)</script> update",
      message: "Your workspace is ready.\n\nOpen it when convenient.",
    }, { recipientName: "Anvesh", audienceReason: "you have an account" });

    expect(content.html).toContain("Hello Anvesh,");
    expect(content.html).toContain("&lt;script&gt;");
    expect(content.html).not.toContain("<script>alert(1)</script>");
    expect(content.html).toContain("IR35Careers Team");
    expect(content.text).toContain("you have an account");
    expect(`${content.subject}${content.html}${content.text}`).not.toMatch(/[—→·]/);
  });

  it("restricts campaign buttons to the production website", () => {
    const draft = normaliseCampaignDraft({
      ...emailCampaignTemplates[0],
      ctaUrl: "https://malicious.example/phishing",
    });
    expect(draft.ctaUrl).toBe("https://www.ir35careers.com/dashboard");
  });

  it("rejects incomplete messages before delivery", () => {
    expect(() => validateCampaignDraft({ ...emailCampaignTemplates[0], message: "Too short" })).toThrow("helpful email message");
    expect(() => validateCampaignDraft({ ...emailCampaignTemplates[0], subject: "" })).toThrow("clear email subject");
  });
});
