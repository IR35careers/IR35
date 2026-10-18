import type { ApplicationRecord, WorkspaceState } from "./types";

const LOCKED_DELIVERY = new Set(["queued", "submitting", "submitted", "skipped"]);
const LOCKED_RECRUITING = new Set(["applied", "viewed", "replied", "interview", "offer", "rejected", "withdrawn", "skipped"]);

/** Rebase an editor action on the current store, never a component's pre-ACK copy. */
export function editApplicationDraft(
  state: WorkspaceState,
  id: string,
  edit: (current: ApplicationRecord) => ApplicationRecord,
  now = new Date().toISOString(),
): { state: WorkspaceState; application: ApplicationRecord | null } {
  const current = state.applications.find(application => application.id === id);
  if (!current || LOCKED_DELIVERY.has(current.deliveryStatus ?? "") || LOCKED_RECRUITING.has(current.status))
    return { state, application: null };
  const application: ApplicationRecord = {
    ...edit(current),
    id: current.id,
    job: current.job,
    deliveryStatus: current.deliveryStatus,
    deliveryVersion: current.deliveryVersion,
    failureReason: current.failureReason,
    errorDetail: current.errorDetail,
    receipt: current.receipt?.mode === "external_handoff" ? current.receipt : null,
    updatedAt: now,
  };
  return { application, state: { ...state, applications: state.applications.map(item => item.id === id ? application : item) } };
}
