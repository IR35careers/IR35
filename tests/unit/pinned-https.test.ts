import { describe, expect, it, vi } from "vitest";
import { createPinnedLookup } from "@/lib/security/pinned-https";

describe("pinned HTTPS DNS lookup", () => {
  it("returns the array shape requested by modern Node runtimes", () => {
    const callback = vi.fn();
    createPinnedLookup("203.0.113.10", 4)(
      "careers.example.com",
      { all: true },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(null, [
      { address: "203.0.113.10", family: 4 },
    ]);
  });

  it("returns the scalar shape for a traditional lookup", () => {
    const callback = vi.fn();
    createPinnedLookup("2001:4860:4860::8888", 6)(
      "careers.example.com",
      { all: false },
      callback,
    );

    expect(callback).toHaveBeenCalledWith(
      null,
      "2001:4860:4860::8888",
      6,
    );
  });
});
