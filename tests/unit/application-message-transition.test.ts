import { describe, expect, it } from "vitest";
import { applicationMessageTransition } from "@/lib/email/application-message-transition";

describe("inbound application status transition", () => {
  it("marks a prepared application applied when the employer confirms receipt", () => {
    expect(applicationMessageTransition("application_update", "ready")).toMatchObject({
      status: "applied",
      notification: "update",
    });
  });

  it("moves trusted interview and rejection messages to their final tracker states", () => {
    expect(applicationMessageTransition("interview", "applied").status).toBe(
      "interview",
    );
    expect(applicationMessageTransition("rejection", "viewed").status).toBe(
      "rejected",
    );
  });

  it("does not downgrade an interview after an unrelated reply", () => {
    expect(applicationMessageTransition("other", "interview").status).toBe(
      "interview",
    );
  });
});
