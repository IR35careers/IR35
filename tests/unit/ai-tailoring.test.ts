import { afterEach, describe, expect, it, vi } from "vitest";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import {
  redactDirectIdentifiers,
  tailorResumeWithFastFallback,
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

  it("rejects a role keyword when the source CV does not evidence it", () => {
    const original = "Built AWS infrastructure using Terraform and improved deployment reliability by 20%.";
    const job = { ...DEMO_JOBS[0], skills: ["AWS", "Kubernetes"], description: "Build AWS and Kubernetes platforms." };
    const accepted = validateTailoringSuggestions([
      { section: "Experience", original, replacement: "Built AWS and Kubernetes infrastructure using Terraform and improved deployment reliability by 20%.", rationale: "Adds a missing role keyword.", evidence_quote: original, keywords: ["AWS", "Kubernetes"], impact: "high" },
    ], cv, job);
    expect(accepted).toHaveLength(0);
  });

  it("rejects overlapping edits so the reviewed preview remains deterministic", () => {
    const profile = "Platform engineer with AWS and Terraform delivery experience.";
    const accepted = validateTailoringSuggestions([
      { section: "Profile", original: profile, replacement: "Platform engineer delivering AWS infrastructure with Terraform.", rationale: "Refines the profile.", evidence_quote: profile, keywords: ["AWS", "Terraform"], impact: "high" },
      { section: "Profile", original: "AWS and Terraform delivery experience", replacement: "AWS infrastructure delivery with Terraform", rationale: "Overlaps the first edit.", evidence_quote: profile, keywords: ["AWS", "Terraform"], impact: "medium" },
    ], cv, DEMO_JOBS[0]);
    expect(accepted).toHaveLength(1);
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

  it("retries with JSON mode when the selected model does not support strict schemas", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    const original = "Built AWS infrastructure using Terraform and improved deployment reliability by 20%.";
    const resultBody = { summary: "Focus the existing cloud evidence.", must_have_requirements: ["AWS"], nice_to_have_requirements: [], suggestions: [{ section: "Experience", original, replacement: "Improved deployment reliability by 20% while building AWS infrastructure with Terraform.", rationale: "Front-loads the outcome.", evidence_quote: original, keywords: ["AWS", "Terraform"], impact: "high" }], cover_letter: "I offer evidenced AWS and Terraform delivery experience." };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "Structured output unsupported" } }), { status: 400, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: `\`\`\`json\n${JSON.stringify(resultBody)}\n\`\`\`` } }] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await tailorResumeWithOpenRouter({ cvText: cv, job: DEMO_JOBS[0] });
    const retryBody = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(retryBody.response_format).toEqual({ type: "json_object" });
    expect(result.suggestions).toHaveLength(1);
  });

  it("uses verified local edits when an enhanced response contains no safe edits", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ summary: "No changes.", must_have_requirements: ["AWS"], nice_to_have_requirements: [], suggestions: [], cover_letter: "" }) } }] }), { status: 200, headers: { "content-type": "application/json" } })));

    const outcome = await tailorResumeWithFastFallback({ cvText: cv, job: DEMO_JOBS[0] });
    expect(outcome.mode).toBe("enhanced");
    expect(outcome.result.suggestions.length).toBeGreaterThan(0);
    expect(outcome.result.suggestions.every((suggestion) => cv.includes(suggestion.original))).toBe(true);
  });

  it("returns the owned evidence result when the enhanced provider fails", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "test-key");
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("provider unavailable")));

    const outcome = await tailorResumeWithFastFallback({ cvText: cv, job: DEMO_JOBS[0], timeoutMs: 5_000 });

    expect(outcome.mode).toBe("local");
    expect(outcome.result.model).toBe("ir35careers-evidence-engine");
    expect(outcome.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it("uses the owned evidence result immediately when no provider is configured", async () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await tailorResumeWithFastFallback({ cvText: cv, job: DEMO_JOBS[0] });

    expect(outcome.mode).toBe("local");
    expect(outcome.result.suggestions).toBeDefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
