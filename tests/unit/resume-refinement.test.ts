import { describe, expect, it } from "vitest";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE, SAMPLE_CV_TEXT } from "@/lib/workspace/seed";
import { prepareApplication } from "@/lib/workspace/engine";
import { buildLocalTailoringResult } from "@/lib/ai/local-tailoring";
import { applyRefinedResume, buildRefinedResumeDraft } from "@/lib/resume/refinement";
import { resumeEvidencesTerm, scoreResumeForRole } from "@/lib/resume/analysis";
import { validateTailoringSuggestions } from "@/lib/ai/openrouter-tailoring";

const job = DEMO_JOBS[0];
const source = `Alex Morgan\n\nPROFILE\nCloud platform engineer.\n\nSKILLS\nGit, Linux, Terraform, AWS\n\nEXPERIENCE\n- I was responsible for AWS infrastructure using Terraform, reducing failures by 28%.`;
const result = buildLocalTailoringResult(source, job);

describe("reviewed resume refinement", () => {
  it("never turns a denied clearance or licence into a positive qualification", () => {
    for (const text of ["I do not hold SC Clearance.", "No active SC Clearance", "SC Clearance not held", "Eligible for SC Clearance", "Forklift licence expired", "No forklift licence", "Learning Kubernetes"]) {
      const term = text.includes("SC") ? "SC Clearance" : text.includes("Kubernetes") ? "Kubernetes" : "Forklift licence";
      expect(resumeEvidencesTerm(text, term), text).toBe(false);
    }
    const text = "Alex Morgan\nPROFILE\nPlatform engineer.\nEXPERIENCE\nBuilt secure AWS platforms. I do not hold SC Clearance.";
    const role = { ...job, skills: ["AWS", "SC Clearance"] };
    expect(scoreResumeForRole(text, role).missingKeywords).toContain("SC Clearance");
    const local = buildLocalTailoringResult(text, role);
    expect(local.suggestions.some((item) => /Core skills:.*SC Clearance/.test(item.replacement))).toBe(false);
    expect(validateTailoringSuggestions([{ original: "Platform engineer.", replacement: "SC Clearance platform engineer.", evidence_quote: "I do not hold SC Clearance." }], text, role)).toEqual([]);
  });
  it("keeps positive evidence separate from unrelated negative statements", () => {
    expect(resumeEvidencesTerm("Built AWS platforms with no production outages.", "AWS")).toBe(true);
    expect(resumeEvidencesTerm("No Azure experience. Built AWS platforms.", "AWS")).toBe(true);
    expect(resumeEvidencesTerm("Current SC Clearance held.", "SC Clearance")).toBe(true);
    expect(resumeEvidencesTerm("Generic security clearance held.", "SC Cleared")).toBe(false);
  });
  it("leaves the original unchanged until edits are selected", () => {
    const draft = buildRefinedResumeDraft({ sourceText: source, suggestions: result.suggestions, selectedIds: [] });
    expect(draft.tailoredText).toBe(source);
    expect(draft.acceptedSuggestionIds).toEqual([]);
  });
  it("uses only selected changes, preserving metrics and missing-skill boundaries", () => {
    const suggestion = result.suggestions.find((item) => item.section === "Skills")!;
    const draft = buildRefinedResumeDraft({ sourceText: source, suggestions: result.suggestions, selectedIds: [suggestion.id] });
    expect(draft.tailoredText).toContain("- AWS");
    expect(draft.tailoredText).toContain("28%");
    expect(draft.tailoredText).not.toContain("Kubernetes");
    expect(draft.sourceText).toBe(source);
  });
  it("honours edits to a chosen suggestion", () => {
    const item = result.suggestions.find((suggestion) => suggestion.section === "Skills")!;
    expect(buildRefinedResumeDraft({ sourceText: source, suggestions: [item], selectedIds: [item.id], replacements: { [item.id]: "AWS | Terraform | Linux | Git" } }).tailoredText).toContain("AWS | Terraform | Linux | Git");
  });
  it("requires a factual example and explicit confirmation for added experience", () => {
    const input = { sourceText: source, suggestions: [], selectedIds: [], evidence: "Deployed Kubernetes workloads on an internal sandbox in 2025." };
    expect(() => buildRefinedResumeDraft(input)).toThrow(/confirm/);
    const draft = buildRefinedResumeDraft({ ...input, evidenceConfirmed: true });
    expect(draft.tailoredText).toContain("ADDITIONAL EXPERIENCE");
    expect(draft.confirmedEvidence).toBe(input.evidence);
  });
  it("rejects stale source and overlapping changes instead of silently dropping edits", () => {
    const item = result.suggestions.find((suggestion) => suggestion.section === "Skills")!;
    expect(() => buildRefinedResumeDraft({ sourceText: "Different text", suggestions: [item], selectedIds: [item.id] })).toThrow(/changed/);
    expect(() => buildRefinedResumeDraft({ sourceText: source, suggestions: [item, { ...item, id: "alternative" }], selectedIds: [item.id, "alternative"] })).toThrow(/overlap/);
  });
  it("preserves the original packet source and clears every submission approval", () => {
    const packet = prepareApplication({ job, profile: SAMPLE_CONTRACTOR_PROFILE, cvText: SAMPLE_CV_TEXT });
    const approved = { ...packet, truthApproved: true, materialsApproved: true, submissionApproved: true };
    const draft = { sourceText: approved.tailoredCvText, tailoredText: `${approved.tailoredCvText}\nReviewed wording.`, acceptedSuggestionIds: [], confirmedEvidence: "" };
    const refined = applyRefinedResume(approved, draft, job);
    expect(refined.sourceCvText).toBe(packet.sourceCvText);
    expect(refined.tailoredCvText).toBe(draft.tailoredText);
    expect(refined.truthApproved).toBe(false);
    expect(refined.materialsApproved).toBe(false);
    expect(refined.submissionApproved).toBe(false);
    expect(refined.status).toBe("needs_review");
  });
  it("never replaces a submitted or running application", () => {
    const packet = prepareApplication({ job, profile: SAMPLE_CONTRACTOR_PROFILE, cvText: SAMPLE_CV_TEXT });
    const draft = { sourceText: packet.tailoredCvText, tailoredText: source, acceptedSuggestionIds: [], confirmedEvidence: "" };
    expect(() => applyRefinedResume({ ...packet, status: "applied" }, draft, job)).toThrow(/cannot be replaced/);
    expect(() => applyRefinedResume(packet, draft, DEMO_JOBS[1])).toThrow(/specific job/);
    expect(() => applyRefinedResume({ ...packet, status: "ready", events: [{ id: "event", applicationId: packet.id, type: "status_changed", label: "Application submission started", createdAt: new Date().toISOString() }] }, draft, job)).toThrow(/cannot be replaced/);
  });
});
