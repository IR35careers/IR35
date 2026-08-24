import { describe, expect, it } from "vitest";
import {
  classifyInboundMessage,
  findLinkedApplication,
  inboxViewCategory,
  isUnsolicitedJobMarketingMessage,
} from "@/lib/workspace/mail";
import { DEMO_JOBS } from "@/lib/demo-jobs";

describe("inbound recruiter mail", () => {
  it("classifies interview, rejection and action-required messages", () => {
    expect(classifyInboundMessage("Interview availability", "Please book a call with the team.")).toBe("interview");
    expect(classifyInboundMessage("Application update", "Unfortunately we are not moving forward.")).toBe("rejection");
    expect(classifyInboundMessage("Action required", "Please confirm your working pattern.")).toBe("action_required");
  });

  it("links a message to the strongest matching application", () => {
    const applications = [
      { id: "northstar", job: DEMO_JOBS[0] },
      { id: "civic", job: DEMO_JOBS[1] },
    ];
    expect(findLinkedApplication("Northstar Digital - Senior DevOps Engineer", "Thanks for applying", applications)).toBe("northstar");
    expect(findLinkedApplication("General update", "No role information", applications)).toBeNull();
  });

  it("filters job-board recommendations without hiding application responses", () => {
    expect(
      isUnsolicitedJobMarketingMessage(
        "Our recommendation: Senior DevOps Engineer",
        "Hello Anvesh, we recommend this job for you. Good Fit. Permanent.",
        "info@jobs.totaljobsmail.com",
      ),
    ).toBe(true);
    expect(
      isUnsolicitedJobMarketingMessage(
        "Application received: Senior DevOps Engineer",
        "Thank you for applying. We have received your application.",
        "no-reply@totaljobs.com",
      ),
    ).toBe(false);
  });

  it("derives detailed inbox categories without changing stored classifications", () => {
    const message = (subject: string, body: string, classification: "interview" | "rejection" | "action_required" | "application_update" | "other" = "other") => ({ subject, body, preview: body, classification });
    expect(inboxViewCategory(message("Verify your email", "Your security code is 123456"))).toBe("verification");
    expect(inboxViewCategory(message("Technical assessment", "Complete the coding test by Friday"))).toBe("assessment");
    expect(inboxViewCategory(message("Application received", "Thank you for applying"))).toBe("applied");
    expect(inboxViewCategory(message("Application ready to retry", "Your approved Resume and answers are saved. Select Apply again."))).toBe("retry");
    expect(inboxViewCategory(message("Offer letter", "We are pleased to offer you the contract"))).toBe("offer");
    expect(inboxViewCategory(message("Working pattern", "Please confirm availability", "action_required"))).toBe("needs_you");
  });
});
