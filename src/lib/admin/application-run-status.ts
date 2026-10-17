export type AdminApplicationRunState =
  | "confirmed"
  | "needs_action"
  | "unavailable"
  | "processing"
  | "failed"
  | "review";

export function classifyAdminApplicationRun(run: {
  status: string;
  errorCode: string | null;
  action: string | null;
}): AdminApplicationRunState {
  if (run.status === "succeeded") return "confirmed";
  if (run.errorCode === "needs_user") return "needs_action";
  if (
    run.errorCode === "listing_unavailable" ||
    run.action === "listing_unavailable"
  )
    return "unavailable";
  if (["queued", "processing"].includes(run.status)) return "processing";
  if (run.status === "failed") return "failed";
  return "review";
}
