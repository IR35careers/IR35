import { describe, expect, it } from "vitest";
import { isSevenAmInLondon, londonHour } from "@/lib/pipeline/schedule";

describe("job source schedule", () => {
  it("runs at 07:00 London time during GMT", () => {
    expect(isSevenAmInLondon(new Date("2026-01-15T07:20:00.000Z"))).toBe(true);
    expect(londonHour(new Date("2026-01-15T06:20:00.000Z"))).toBe(6);
  });

  it("runs at 07:00 London time during British Summer Time", () => {
    expect(isSevenAmInLondon(new Date("2026-08-21T06:20:00.000Z"))).toBe(true);
    expect(isSevenAmInLondon(new Date("2026-08-21T07:20:00.000Z"))).toBe(false);
  });

  it("fails closed for an invalid date", () => {
    expect(londonHour(new Date("invalid"))).toBeNull();
  });
});
