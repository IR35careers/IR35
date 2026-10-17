import { afterEach, describe, expect, it, vi } from "vitest";
import { isSupabaseOAuthProviderEnabled } from "@/lib/supabase-config";

const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const originalAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

afterEach(() => {
  vi.unstubAllGlobals();
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalUrl;
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = originalAnonKey;
});

describe("Supabase OAuth provider settings", () => {
  it("detects an enabled provider before redirecting", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co/";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      external: { github: true, google: true },
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(isSupabaseOAuthProviderEnabled("GitHub")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://project.supabase.co/auth/v1/settings",
      expect.objectContaining({
        cache: "no-store",
        headers: { apikey: "public-anon-key" },
      }),
    );
  });

  it("stops the redirect when the provider is disabled", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      external: { github: false },
    }), { status: 200 })));

    await expect(isSupabaseOAuthProviderEnabled("github")).resolves.toBe(false);
  });

  it("fails closed when settings cannot be read", async () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network unavailable")));

    await expect(isSupabaseOAuthProviderEnabled("github")).resolves.toBe(false);
  });
});
