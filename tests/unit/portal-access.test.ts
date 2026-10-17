import { describe, expect, it } from "vitest";
import { ADMIN_PORTAL_ORIGIN, authenticatedDestination, isAdministratorEmail } from "@/lib/portal-access";

describe("portal access routing", () => {
  it("recognises the owner and additional administrator identities", () => {
    expect(isAdministratorEmail("ir35careers@gmail.com")).toBe(true);
    expect(isAdministratorEmail(" IR35CAREERS@GMAIL.COM ")).toBe(true);
    expect(isAdministratorEmail("info@ir35careers.com")).toBe(true);
    expect(isAdministratorEmail(" INFO@IR35CAREERS.COM ")).toBe(true);
    expect(isAdministratorEmail("info@ir35careers.com.attacker.example")).toBe(false);
    expect(isAdministratorEmail("contractor@example.com")).toBe(false);
  });

  it("keeps administrator and contractor destinations separate", () => {
    expect(authenticatedDestination("ir35careers@gmail.com", "/dashboard")).toBe(`${ADMIN_PORTAL_ORIGIN}/`);
    expect(authenticatedDestination("info@ir35careers.com", "/dashboard")).toBe(`${ADMIN_PORTAL_ORIGIN}/`);
    expect(authenticatedDestination("contractor@example.com", "/saved")).toBe("/saved");
  });
});
