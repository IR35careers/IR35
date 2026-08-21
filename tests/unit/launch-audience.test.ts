import { describe, expect, it } from "vitest";
import { normaliseLaunchEmail, planLaunchAudience, type LaunchAudienceRow } from "@/lib/email/launch-audience";

function row(id: string, email: string, notified = false): LaunchAudienceRow {
  return {
    id,
    email,
    created_at: "2026-07-18T04:14:00.000Z",
    launch_notified_at: notified ? "2026-08-21T10:00:00.000Z" : null,
    launch_email_attempts: 0,
  };
}

describe("public beta launch audience", () => {
  it("applies the approved Brittan address correction", () => {
    expect(normaliseLaunchEmail(" Chris@Brittan.co ")).toBe("chris@brittan.com");
  });

  it("removes registered duplicates, invalid examples, repeats and previously notified rows", () => {
    const plan = planLaunchAudience(
      [
        row("1", "chris@brittan.co"),
        row("2", "amit.kumar789@example.com"),
        row("3", "candidate@gmail.com"),
        row("4", "CANDIDATE@gmail.com"),
        row("5", "already@gmail.com", true),
        row("6", "ready@gmail.com"),
      ],
      ["chris@brittan.com"]
    );

    expect(plan.recipients.map((item) => item.email)).toEqual(["candidate@gmail.com", "ready@gmail.com"]);
    expect(plan.duplicateRows.map((item) => item.id)).toEqual(["1", "4"]);
    expect(plan.invalidRows.map((item) => item.id)).toEqual(["2"]);
    expect(plan.alreadyNotifiedRows.map((item) => item.id)).toEqual(["5"]);
    expect(plan.corrections).toEqual([{ id: "1", from: "chris@brittan.co", to: "chris@brittan.com" }]);
  });
});
