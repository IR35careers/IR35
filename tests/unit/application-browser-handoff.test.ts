import { describe, expect, it, vi } from "vitest";
import {
  createApplicationBrowserHandoff,
  loadApplicationBrowserHandoff,
} from "@/lib/application-browser-handoff";

function adminDouble() {
  const files = new Map<string, string>();
  const bucket = {
    upload: vi.fn(async (path: string, value: Buffer) => {
      files.set(path, value.toString("utf8"));
      return { error: null };
    }),
    download: vi.fn(async (path: string) => {
      const value = files.get(path);
      return value
        ? { data: new Blob([value]), error: null }
        : { data: null, error: { message: "not found" } };
    }),
    remove: vi.fn(async (paths: string[]) => {
      paths.forEach((path) => files.delete(path));
      return { error: null };
    }),
  };
  return {
    admin: {
      storage: {
        getBucket: vi.fn(async () => ({ data: { id: "application-browser-handoffs" }, error: null })),
        createBucket: vi.fn(async () => ({ error: null })),
        from: vi.fn(() => bucket),
      },
    },
    files,
  };
}

describe("application browser handoffs", () => {
  it("creates, claims and reloads a short-lived opaque handoff", async () => {
    const { admin } = adminDouble();
    const created = await createApplicationBrowserHandoff({
      admin: admin as never,
      userId: "11111111-1111-4111-8111-111111111111",
      applicationId: "22222222-2222-4222-8222-222222222222",
      destination: "https://jobs.example.test/apply",
    });
    expect(created.token).toMatch(/^[A-Za-z0-9_-]{40,60}$/);
    const claimed = await loadApplicationBrowserHandoff({
      admin: admin as never,
      token: created.token,
      claim: true,
    });
    expect(claimed?.applicationId).toBe("22222222-2222-4222-8222-222222222222");
    expect(claimed?.claimedAt).toBeTruthy();
  });

  it("rejects malformed tokens without touching storage", async () => {
    const { admin } = adminDouble();
    expect(
      await loadApplicationBrowserHandoff({
        admin: admin as never,
        token: "not-a-token",
      }),
    ).toBeNull();
    expect(admin.storage.from).not.toHaveBeenCalled();
  });
});
