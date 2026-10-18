import { beforeEach, describe, expect, it } from "vitest";
import { editApplicationDraft } from "@/lib/workspace/draft-edit";
import { updateWorkspace, flushWorkspaceChanges, clearWorkspaceForSignOut } from "@/lib/workspace/store";
import { prepareApplication } from "@/lib/workspace/engine";
import { createSeedWorkspaceState, SAMPLE_CONTRACTOR_PROFILE, SAMPLE_CV_TEXT } from "@/lib/workspace/seed";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import type { ApplicationRecord } from "@/lib/workspace/types";

function draft(): ApplicationRecord {
  return { ...prepareApplication({ job: DEMO_JOBS[0], profile: SAMPLE_CONTRACTOR_PROFILE, cvText: SAMPLE_CV_TEXT }),
    deliveryStatus: "awaiting_approval", deliveryVersion: 1 };
}
beforeEach(() => { clearWorkspaceForSignOut(); });

describe("application editor/store save acknowledgement race", () => {
  it("keeps a keystroke after an ACK arrives before the component catches up", async () => {
    const componentCopy = draft();
    updateWorkspace(state => ({ ...state, applications: [componentCopy] }));
    const acknowledged = { ...componentCopy, deliveryVersion: 2, coverLetter: "Latest acknowledged cover letter." };
    updateWorkspace(state => ({ ...state, applications: [acknowledged] }));

    // The old editor passed its version-1 local snapshot back into the store.
    // The correct stale-state guard then discarded that snapshot and its edit.
    updateWorkspace(state => ({ ...state, applications: [{ ...componentCopy, questions: componentCopy.questions.map(q =>
      q.id === "availability" ? { ...q, answer: "This keystroke was discarded." } : q) }] }));
    expect((await flushWorkspaceChanges()).applications[0].questions.find(q => q.id === "availability")?.answer)
      .not.toBe("This keystroke was discarded.");

    // The fixed editor's action runs against the current store/version instead.
    updateWorkspace(state => editApplicationDraft(state, componentCopy.id, current => ({ ...current,
      questions: current.questions.map(q => q.id === "availability" ? { ...q, answer: "Four weeks after contract approval." } : q),
    })).state);
    const saved = (await flushWorkspaceChanges()).applications[0];
    expect(saved.deliveryVersion).toBe(2);
    expect(saved.coverLetter).toBe(acknowledged.coverLetter);
    expect(saved.questions.find(q => q.id === "availability")?.answer).toBe("Four weeks after contract approval.");
  });
  it("composes rapid answer and material edits without replacing the other fields", async () => {
    const application = draft();
    updateWorkspace(state => ({ ...state, applications: [application] }));
    for (const answer of ["Two", "Two weeks"]) updateWorkspace(state => editApplicationDraft(state, application.id, current => ({ ...current,
      questions: current.questions.map(q => q.id === "availability" ? { ...q, answer } : q),
    })).state);
    updateWorkspace(state => editApplicationDraft(state, application.id, current => ({ ...current, coverLetter: "Reviewed cover letter." })).state);
    const saved = (await flushWorkspaceChanges()).applications[0];
    expect(saved.coverLetter).toBe("Reviewed cover letter.");
    expect(saved.questions.find(q => q.id === "availability")?.answer).toBe("Two weeks");
  });
  it.each(["queued", "submitting", "submitted", "skipped"] as const)("never edits a server-owned %s application from a stale callback", deliveryStatus => {
    const application = { ...draft(), deliveryStatus, deliveryVersion: 3 };
    const state = { ...createSeedWorkspaceState(), applications: [application] };
    let invoked = false;
    const result = editApplicationDraft(state, application.id, current => { invoked = true; return { ...current, status: "ready" }; });
    expect(invoked).toBe(false);
    expect(result).toEqual({ state, application: null });
    expect(result.state).toBe(state);
  });
  it("preserves server-owned metadata even if an editor callback supplies stale values", () => {
    const application = { ...draft(), deliveryVersion: 4, failureReason: "employer_action_required" };
    const state = { ...createSeedWorkspaceState(), applications: [application] };
    const result = editApplicationDraft(state, application.id, current => ({ ...current, id: "other", deliveryVersion: 1,
      deliveryStatus: "draft", failureReason: null, receipt: { receiptId: "forged", mode: "external_handoff", destination: "https://mock.example.test", createdAt: "", reviewedFields: [], skippedFields: [], message: "" } }));
    expect(result.application).toMatchObject({ id: application.id, deliveryVersion: 4, deliveryStatus: "awaiting_approval",
      failureReason: "employer_action_required", receipt: null });
  });
  it("does not recreate an application removed from the current workspace", () => {
    const state = createSeedWorkspaceState();
    expect(editApplicationDraft(state, "no-longer-owned", current => current)).toEqual({ state, application: null });
  });
});
