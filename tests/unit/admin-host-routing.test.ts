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
});
