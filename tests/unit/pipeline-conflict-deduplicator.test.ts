import { describe, expect, it } from "vitest";
import { collapseConflictKeyDuplicates } from "@/lib/pipeline/conflict-deduplicator";

interface Listing {
  source_domain: string;
  source_identifier: string;
  description: string;
}

describe("collapseConflictKeyDuplicates", () => {
  it("collapses a repeated database conflict key and can retain the richer record", () => {
    const result = collapseConflictKeyDuplicates<Listing>(
      [
        {
          source_domain: "reed.co.uk",
          source_identifier: "12345",
          description: "Short snippet",
        },
        {
          source_domain: "reed.co.uk",
          source_identifier: "12345",
          description: "A complete and substantially richer job description",
        },
      ],
      (current, candidate) =>
        candidate.description.length > current.description.length ? candidate : current
    );

    expect(result.collapsed).toBe(1);
    expect(result.records).toHaveLength(1);
    expect(result.records[0].description).toContain("complete");
  });

  it("preserves the same identifier when it belongs to a different source", () => {
    const result = collapseConflictKeyDuplicates<Listing>([
      { source_domain: "reed.co.uk", source_identifier: "12345", description: "Reed" },
      { source_domain: "adzuna.co.uk", source_identifier: "12345", description: "Adzuna" },
    ]);

    expect(result.collapsed).toBe(0);
    expect(result.records).toHaveLength(2);
  });

  it("preserves different identifiers from the same source", () => {
    const result = collapseConflictKeyDuplicates<Listing>([
      { source_domain: "reed.co.uk", source_identifier: "12345", description: "First" },
      { source_domain: "reed.co.uk", source_identifier: "67890", description: "Second" },
    ]);

    expect(result.collapsed).toBe(0);
    expect(result.records.map((record) => record.source_identifier)).toEqual(["12345", "67890"]);
  });

  it("returns an empty result for an empty batch", () => {
    expect(collapseConflictKeyDuplicates<Listing>([])).toEqual({ records: [], collapsed: 0 });
  });
});
