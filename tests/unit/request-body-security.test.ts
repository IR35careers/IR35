import { describe, expect, it } from "vitest";
import { readFormDataBody, readJsonBody } from "@/lib/security/request-body";

describe("bounded request body parsing", () => {
  it("rejects a streamed JSON body that exceeds the limit without Content-Length", async () => {
    const request = new Request("https://www.ir35careers.com/api/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: "x".repeat(100) }),
    });
    await expect(readJsonBody(request, 32)).rejects.toMatchObject({ status: 413 });
  });

  it("rejects the wrong JSON media type", async () => {
    const request = new Request("https://www.ir35careers.com/api/test", {
      method: "POST",
      headers: { "content-type": "text/plain" },
      body: "{}",
    });
    await expect(readJsonBody(request, 100)).rejects.toMatchObject({ status: 415 });
  });

  it("parses multipart data only after bounding the complete body", async () => {
    const form = new FormData();
    form.set("file", new File(["safe"], "cv.txt", { type: "text/plain" }));
    const request = new Request("https://www.ir35careers.com/api/test", { method: "POST", body: form });
    const parsed = await readFormDataBody(request, 10_000);
    expect(parsed.get("file")).toBeInstanceOf(File);
  });
});
