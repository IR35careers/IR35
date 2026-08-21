import { describe, expect, it, vi } from "vitest";
import {
  fetchWithFreshSession,
  getFreshAccessToken,
  promiseWithTimeout,
  sessionNeedsRefresh,
  type SessionAuthClient,
} from "@/lib/authenticated-fetch";

function authClient(input: {
  currentToken?: string;
  currentExpiry?: number;
  refreshedToken?: string;
}): SessionAuthClient {
  return {
    auth: {
      getSession: vi.fn().mockResolvedValue({
        data: {
          session: input.currentToken
            ? { access_token: input.currentToken, expires_at: input.currentExpiry }
            : null,
        },
        error: null,
      }),
      refreshSession: vi.fn().mockResolvedValue({
        data: {
          session: input.refreshedToken
            ? { access_token: input.refreshedToken, expires_at: Math.floor(Date.now() / 1000) + 3_600 }
            : null,
        },
        error: input.refreshedToken ? null : { message: "expired" },
      }),
    },
  } as SessionAuthClient;
}

describe("authenticated requests", () => {
  it("detects sessions that are too close to expiry", () => {
    expect(sessionNeedsRefresh(null, 1_000)).toBe(true);
    expect(sessionNeedsRefresh({ access_token: "token", expires_at: 1_050 } as never, 1_000)).toBe(true);
    expect(sessionNeedsRefresh({ access_token: "token", expires_at: 1_500 } as never, 1_000)).toBe(false);
  });

  it("refreshes an expired browser session before using it", async () => {
    const client = authClient({ currentToken: "old", currentExpiry: 1, refreshedToken: "fresh" });
    await expect(getFreshAccessToken(client)).resolves.toBe("fresh");
    expect(client.auth.refreshSession).toHaveBeenCalledOnce();
  });

  it("retries one 401 response with a refreshed access token", async () => {
    const client = authClient({ currentToken: "current", currentExpiry: Math.floor(Date.now() / 1000) + 3_600, refreshedToken: "fresh" });
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "expired" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const response = await fetchWithFreshSession("/api/applications/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ applicationId: "example" }),
    }, { client, fetcher });

    expect(response.status).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(new Headers(fetcher.mock.calls[0][1]?.headers).get("authorization")).toBe("Bearer current");
    expect(new Headers(fetcher.mock.calls[1][1]?.headers).get("authorization")).toBe("Bearer fresh");
  });

  it("ends a stalled authentication operation with a useful error", async () => {
    await expect(promiseWithTimeout(new Promise<string>(() => undefined), 5, "Session check timed out."))
      .rejects.toThrow("Session check timed out.");
  });
});
