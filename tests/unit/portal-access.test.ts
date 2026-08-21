import { describe, expect, it } from "vitest";
import { ADMIN_PORTAL_ORIGIN, authenticatedDestination, isAdministratorEmail } from "@/lib/portal-access";

describe("portal access routing", () => {
  it("recognises only the approved administrator identity", () => {
    expect(isAdministratorEmail("ir35careers@gmail.com")).toBe(true);
    expect(isAdministratorEmail(" IR35CAREERS@GMAIL.COM ")).toBe(true);
    expect(isAdministratorEmail("contractor@example.com")).toBe(false);
  });

  it("keeps administrator and contractor destinations separate", () => {
    expect(authenticatedDestination("ir35careers@gmail.com", "/dashboard")).toBe(`${ADMIN_PORTAL_ORIGIN}/`);
    expect(authenticatedDestination("contractor@example.com", "/saved")).toBe("/saved");
  });
});
