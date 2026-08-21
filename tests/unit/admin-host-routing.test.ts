import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "../../src/proxy";

describe("admin host routing", () => {
  it("keeps the dedicated admin URL clean while serving the protected workspace", () => {
    const request = new NextRequest("https://admin.ir35careers.com/", {
      headers: { host: "admin.ir35careers.com" },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://admin.ir35careers.com/admin");
  });

  it("does not rewrite the public website root", () => {
    const request = new NextRequest("https://www.ir35careers.com/", {
      headers: { host: "www.ir35careers.com" },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-rewrite")).toBeNull();
  });

  it("serves a clean login path on the dedicated admin host", () => {
    const request = new NextRequest("https://admin.ir35careers.com/login", {
      headers: { host: "admin.ir35careers.com" },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-rewrite")).toBe("https://admin.ir35careers.com/admin/login");
  });

  it("moves the legacy public admin path to the dedicated host", () => {
    const request = new NextRequest("https://www.ir35careers.com/admin", {
      headers: { host: "www.ir35careers.com" },
    });
    const response = proxy(request);
    expect(response.headers.get("location")).toBe("https://admin.ir35careers.com/");
  });

  it("never serves contractor workspace routes from the admin domain", () => {
    const request = new NextRequest("https://admin.ir35careers.com/dashboard", {
      headers: { host: "admin.ir35careers.com" },
    });
    const response = proxy(request);
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://admin.ir35careers.com/");
  });

  it("keeps admin APIs available on the admin domain", () => {
    const request = new NextRequest("https://admin.ir35careers.com/api/admin", {
      headers: { host: "admin.ir35careers.com" },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
