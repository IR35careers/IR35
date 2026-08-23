import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { verifyApplicationWorkerBody } from "@/lib/application-worker-auth";
import { kickApplicationWorker } from "@/lib/application-worker-kick";

const original = {
  enabled: process.env.APPLICATION_WORKER_ENABLED,
  secret: process.env.APPLICATION_WORKER_SECRET,
  origin: process.env.IR35CAREERS_APP_URL,
};

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

describe("cloud application worker kick", () => {
  beforeEach(() => {
    process.env.APPLICATION_WORKER_ENABLED = "true";
    process.env.APPLICATION_WORKER_SECRET =
      "worker-test-secret-that-is-long-enough-123";
    process.env.IR35CAREERS_APP_URL = "https://www.ir35careers.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    restoreEnvironment("APPLICATION_WORKER_ENABLED", original.enabled);
    restoreEnvironment("APPLICATION_WORKER_SECRET", original.secret);
    restoreEnvironment("IR35CAREERS_APP_URL", original.origin);
  });

  it("sends an authenticated cloud drain request", async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const body = String(init?.body || "");
      const headers = new Headers(init?.headers);
      expect(
        verifyApplicationWorkerBody({
          body,
          timestamp: headers.get("x-ir35-worker-timestamp") || "",
          signature: headers.get("x-ir35-worker-signature") || "",
        }),
      ).toBe(true);
      expect(JSON.parse(body)).toMatchObject({
        applicationId: "2344d4ef-4afd-42c3-b4f0-979e671e81a7",
        reason: "application_approved",
      });
      return Response.json({ ok: true, state: "submitted" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      kickApplicationWorker({
        applicationId: "2344d4ef-4afd-42c3-b4f0-979e671e81a7",
        reason: "application_approved",
      }),
    ).resolves.toBe("accepted");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://www.ir35careers.com/api/applications/worker/drain",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("does nothing when the worker is disabled", async () => {
    process.env.APPLICATION_WORKER_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(kickApplicationWorker()).resolves.toBe("disabled");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
