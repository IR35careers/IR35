import { describe, expect, it } from "vitest";
import { readJsonResponse, readResponseText, ResponseBodyError } from "@/lib/security/response-body";

describe("bounded upstream responses", () => {
  it("parses JSON within the configured byte limit", async () => {
    const response = new Response(JSON.stringify({ ok: true }));
    await expect(readJsonResponse<{ ok: boolean }>(response, 1_000)).resolves.toEqual({ ok: true });
  });

  it("rejects declared and streamed bodies above the limit", async () => {
    await expect(readResponseText(new Response("small", { headers: { "content-length": "999" } }), 10)).rejects.toBeInstanceOf(ResponseBodyError);
    await expect(readResponseText(new Response("0123456789abcdef"), 8)).rejects.toBeInstanceOf(ResponseBodyError);
  });

  it("returns null for invalid JSON without exposing the body", async () => {
    await expect(readJsonResponse(new Response("not-json"), 100)).resolves.toBeNull();
  });
});
