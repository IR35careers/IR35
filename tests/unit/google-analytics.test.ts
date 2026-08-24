import { describe, expect, it } from "vitest";
import { analyticsRows } from "@/lib/google-analytics";

describe("Google Analytics report presentation", () => {
  it("maps aggregate rows without exposing identifiers", () => {
    const rows = analyticsRows({ rows: [
      { dimensionValues: [{ value: "London" }, { value: "England" }, { value: "United Kingdom" }], metricValues: [{ value: "18" }] },
      { dimensionValues: [{ value: "Manchester" }, { value: "England" }, { value: "United Kingdom" }], metricValues: [{ value: "7" }] },
    ] }, ([city, region, country]) => ({ label: city, secondary: `${region}, ${country}` }));

    expect(rows).toEqual([
      { label: "London", secondary: "England, United Kingdom", value: 18 },
      { label: "Manchester", secondary: "England, United Kingdom", value: 7 },
    ]);
  });

  it("normalises missing and invalid values", () => {
    const rows = analyticsRows({ rows: [{ dimensionValues: [{}], metricValues: [{ value: "not-a-number" }] }] }, ([label]) => ({ label }));
    expect(rows).toEqual([{ label: "Not set", value: 0 }]);
  });
});
