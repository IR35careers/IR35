import { describe, expect, it } from "vitest";
import {
  mergeManagedSourceDefaults,
  normaliseManagedSources,
  removeManagedSource,
  setManagedSourceEnabled,
  upsertManagedSource,
  validateManagedJobSource,
  type ManagedJobSource,
} from "@/lib/ats/source-registry";

const existing: ManagedJobSource = {
  id: "greenhouse:example",
  name: "Example Ltd",
  type: "greenhouse",
  slug: "example",
  enabled: true,
  builtIn: false,
  createdAt: "2026-08-21T06:00:00.000Z",
  updatedAt: "2026-08-21T06:00:00.000Z",
};

describe("free ATS source registry", () => {
  it("accepts only fixed public ATS providers and safe board identifiers", () => {
    expect(validateManagedJobSource({ name: "  Example Agency  ", type: "Lever", slug: "Example-UK" }))
      .toEqual({ name: "Example Agency", type: "lever", slug: "example-uk" });
    expect(() => validateManagedJobSource({ name: "Bad", type: "workday", slug: "tenant" })).toThrow(/supported free ATS/i);
    expect(() => validateManagedJobSource({ name: "Bad", type: "lever", slug: "https://evil.test/a" })).toThrow(/board identifier/i);
  });

  it("deduplicates providers by provider and board identifier", () => {
    const rows = normaliseManagedSources([existing, { ...existing, name: "Updated name", enabled: false }]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: existing.id, name: "Updated name", enabled: false });
  });

  it("adds, updates and disables a source without losing its creation time", () => {
    const added = upsertManagedSource([], existing, "2026-08-21T07:00:00.000Z");
    const updated = upsertManagedSource(added, { name: "Example Recruitment", type: "greenhouse", slug: "example" }, "2026-08-21T08:00:00.000Z");
    const disabled = setManagedSourceEnabled(updated, existing.id, false, "2026-08-21T09:00:00.000Z");
    expect(disabled[0]).toMatchObject({
      name: "Example Recruitment",
      enabled: false,
      createdAt: "2026-08-21T07:00:00.000Z",
      updatedAt: "2026-08-21T09:00:00.000Z",
    });
  });

  it("prevents deletion of built-in sources but removes administrator additions", () => {
    expect(removeManagedSource([existing], existing.id)).toEqual([]);
    expect(() => removeManagedSource([{ ...existing, builtIn: true }], existing.id)).toThrow(/switched off/i);
  });

  it("adds newly shipped starter boards without re-enabling an existing paused board", () => {
    const stored = [{ ...existing, builtIn: true, enabled: false }];
    const newStarter: ManagedJobSource = {
      ...existing,
      id: "greenhouse:new-starter",
      name: "New Starter",
      slug: "new-starter",
      builtIn: true,
      enabled: true,
    };
    const merged = mergeManagedSourceDefaults(stored, [{ ...existing, builtIn: true }, newStarter]);
    expect(merged).toHaveLength(2);
    expect(merged.find((source) => source.id === existing.id)?.enabled).toBe(false);
    expect(merged.find((source) => source.id === newStarter.id)).toMatchObject({ builtIn: true, enabled: true });
  });
});
