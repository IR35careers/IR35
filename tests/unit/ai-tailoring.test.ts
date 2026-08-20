import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import {
  redactDirectIdentifiers,
  tailorResumeWithOpenRouter,
  validateTailoringSuggestions,
} from "@/lib/ai/openrouter-tailoring";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const cv = `Alex Morgan
alex@example.com | +44 7700 900123 | linkedin.com/in/alex-morgan

PROFILE
Platform engineer with AWS and Terraform delivery experience.

EXPERIENCE
Built AWS infrastructure using Terraform and improved deployment reliability by 20%.`;

describe("OpenRouter CV tailoring", () => {
  it("redacts direct contact identifiers before provider processing", () => {
    const redacted = redactDirectIdentifiers(cv);
    expect(redacted).not.toContain("alex@example.com");
    expect(redacted).not.toContain("7700");
    expect(redacted).not.toContain("linkedin.com/in/alex-morgan");
    expect(redacted).toContain("AWS and Terraform");
  });

  it("rejects edits without exact CV evidence or with invented numbers", () => {
    const original = "Built AWS infrastructure using Terraform and improved deployment reliability by 20%.";
    const accepted = validateTailoringSuggestions([
      { section: "Experience", original, replacement: "Improved deployment reliability by 20% while building AWS infrastructure with Terraform.", rationale: "Front-loads the result.", evidence_quote: original, keywords: ["AWS", "Terraform"], impact: "high" },
      { section: "Experience", original, replacement: "Improved deployment reliability by 50%.", rationale: "Invented.", evidence_quote: original, keywords: [], impact: "high" },
      { section: "Experience", original: "Led Kubernetes migrations.", replacement: "Led Kubernetes migrations.", rationale: "Absent.", evidence_quote: original, keywords: ["Kubernetes"], impact: "high" },
    ], cv);
    expect(accepted).toHaveLength(1);
    expect(accepted[0].replacement).toContain("20%");
  });

  it("requests private structured output and keeps identifiers out of the request", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const original = "Built AWS infrastructure using Terraform and improved deployment reliability by 20%.";
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "Focus the existing cloud evidence.", must_have_requirements: ["AWS"], nice_to_have_requirements: ["Kubernetes"], suggestions: [{ section: "Experience", original, replacement: "Improved deployment reliability by 20% while building AWS infrastructure with Terraform.", rationale: "Front-loads the outcome.", evidence_quote: original, keywords: ["AWS", "Terraform"], impact: "high" }], cover_letter: "I offer evidenced AWS and Terraform delivery experience." }) } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await tailorResumeWithOpenRouter({ cvText: cv, job: DEMO_JOBS[0] });
    const requestBody = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(requestBody.provider).toMatchObject({ zdr: true, data_collection: "deny" });
    expect(requestBody.response_format.type).toBe("json_schema");
    expect(JSON.stringify(requestBody)).not.toContain("alex@example.com");
    expect(result.suggestions).toHaveLength(1);
    expect(result.privacy.zeroDataRetentionRequested).toBe(true);
  });
});
