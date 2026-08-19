import { describe, expect, it } from "vitest";
import { classifyInboundMessage, findLinkedApplication } from "@/lib/workspace/mail";
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
});
