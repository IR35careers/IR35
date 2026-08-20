import { describe, expect, it } from "vitest";
import { buildReferralDraft, countDueFollowUps } from "@/lib/workspace/network";
import type { NetworkContact } from "@/lib/workspace/types";

const contact: NetworkContact = {
  id: "contact-1",
  name: "Sam Taylor",
  company: "Example Client",
  role: "Engineering Lead",
  relationship: "former delivery colleague",
  channel: "LinkedIn",
  notes: "",
  nextFollowUp: "2026-08-20",
  stage: "warm",
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

describe("network and referral helpers", () => {
  it("creates a low-pressure draft without inventing an endorsement", () => {
    const draft = buildReferralDraft({
      contact,
      jobTitle: "Platform Engineer",
      company: "Example Client",
      senderName: "Alex Morgan",
    });
    expect(draft).toContain("Hi Sam");
    expect(draft).toContain("if you genuinely think my background is relevant");
    expect(draft).toContain("No pressure");
    expect(draft).not.toContain("you recommended me");
  });

  it("counts only open follow-ups due on or before the selected day", () => {
    expect(countDueFollowUps([
      contact,
      { ...contact, id: "future", nextFollowUp: "2026-08-22" },
      { ...contact, id: "closed", nextFollowUp: "2026-08-19", stage: "closed" },
    ], new Date("2026-08-20T12:00:00.000Z"))).toBe(1);
  });
});
