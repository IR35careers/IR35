import { describe, expect, it, vi } from "vitest";
const cache = vi.hoisted(() => ({ revalidateTag: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => cache);
import { invalidatePublicJobs } from "@/lib/pipeline/invalidate-public-jobs";

describe("public inventory cache coherence", () => {
  it("expires both inventory data and the separate sitemap route", () => {
    invalidatePublicJobs();
    expect(cache.revalidateTag).toHaveBeenCalledWith("public-jobs", { expire: 0 });
    expect(cache.revalidatePath).toHaveBeenCalledWith("/sitemap.xml");
  });
});
