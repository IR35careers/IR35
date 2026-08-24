import { describe, expect, it } from "vitest";
import { analyticsCsv, buildAnalyticsSnapshot } from "@/lib/workspace/analytics";
import { createSeedWorkspaceState } from "@/lib/workspace/seed";

describe("application analytics", () => {
  it("builds a deterministic funnel and account-owned action signals", () => {
    const workspace = createSeedWorkspaceState();
    const snapshot = buildAnalyticsSnapshot(workspace, new Date("2026-08-20T12:00:00.000Z"));

    expect(snapshot.total).toBe(1);
    expect(snapshot.submitted).toBe(1);
    expect(snapshot.responses).toBe(1);
    expect(snapshot.responseRate).toBe(100);
    expect(snapshot.averageMatch).toBeGreaterThan(0);
    expect(snapshot.unreadMessages).toBe(1);
    expect(snapshot.insights.join(" ")).toMatch(/recruiter message/i);
    expect(snapshot.funnel.map((item) => item.label)).toEqual(["Prepared", "Applied", "Responses", "Interviews", "Offers"]);
  });

  it("exports role data as escaped CSV without Resume or message contents", () => {
    const workspace = createSeedWorkspaceState();
    workspace.applications[0] = {
      ...workspace.applications[0],
      job: { ...workspace.applications[0].job, title: 'Engineer, "Platform"' },
    };
    const csv = analyticsCsv(workspace);

    expect(csv).toContain('"Engineer, ""Platform"""');
    expect(csv).toContain("Northstar Digital");
    expect(csv).not.toContain(workspace.applications[0].sourceCvText);
    expect(csv).not.toContain(workspace.messages[0].body);
  });

  it("neutralises spreadsheet formulas in exported user-controlled fields", () => {
    const workspace = createSeedWorkspaceState();
    workspace.applications[0] = {
      ...workspace.applications[0],
      job: { ...workspace.applications[0].job, company_name: "=HYPERLINK(\"https://attacker.invalid\")" },
    };
    expect(analyticsCsv(workspace)).toContain("'=HYPERLINK");
  });

  it("uses neutral zero values when no application has been prepared", () => {
    const workspace = createSeedWorkspaceState();
    workspace.applications = [];
    workspace.messages = [];
    workspace.profile.networkContacts = [];
    const snapshot = buildAnalyticsSnapshot(workspace, new Date("2026-08-20T12:00:00.000Z"));
    expect(snapshot.total).toBe(0);
    expect(snapshot.responseRate).toBe(0);
    expect(snapshot.averageKnownDayRate).toBeNull();
    expect(snapshot.insights[0]).toMatch(/first role-specific application/i);
  });
});
