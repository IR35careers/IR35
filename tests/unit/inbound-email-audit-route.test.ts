import { afterEach, describe, expect, it } from "vitest";
import { POST } from "@/app/api/internal/inbound-email-audit/route";

const originalSecret = process.env.INBOUND_AUDIT_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.INBOUND_AUDIT_SECRET;
  else process.env.INBOUND_AUDIT_SECRET = originalSecret;
});

function request(token?: string): Request {
  return new Request(
    "https://www.ir35careers.com/api/internal/inbound-email-audit",
    {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    },
  );
}

describe("protected inbound email audit", () => {
  it("is unavailable when no audit secret is configured", async () => {
    delete process.env.INBOUND_AUDIT_SECRET;
    const response = await POST(request());
    expect(response.status).toBe(404);
  });

  it("does not reveal the endpoint for an incorrect token", async () => {
    process.env.INBOUND_AUDIT_SECRET = "a".repeat(48);
    const response = await POST(request("b".repeat(48)));
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({ error: "Not found." });
  });

  it("rejects short configured secrets even when supplied correctly", async () => {
    process.env.INBOUND_AUDIT_SECRET = "short-secret";
    const response = await POST(request("short-secret"));
    expect(response.status).toBe(404);
  });
});
