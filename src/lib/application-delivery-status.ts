type Row = Record<string, unknown>;

export type ApplicationDeliveryState =
  | "employer_portal_confirmed"
  | "employer_email_dispatched"
  | "contractor_confirmed"
  | "succeeded_without_receipt"
  | "queued"
  | "running"
  | "worker_lease_expired"
  | "needs_user"
  | "failed"
  | "cancelled"
  | "approval_required"
  | "draft"
  | "approved_without_submission"
  | "processing_without_worker";

export type ApplicationDeliveryRow = {
  applicationId: string;
  submissionId: string;
  taskId: string;
  jobId: string;
  jobTitle: string;
  companyName: string;
  applyHost: string;
  sourceHost: string;
  state: ApplicationDeliveryState;
  packetStatus: string;
  submissionStatus: string;
  workerStatus: string;
  attempts: number;
  updatedAt: string | null;
  submittedAt: string | null;
  availableAt: string | null;
  leaseExpiresAt: string | null;
  action: string;
  errorCode: string;
  message: string;
  approvals: {
    truth: boolean;
    materials: boolean;
    submission: boolean;
    requiredAnswersMissing: number;
    ready: boolean;
  };
};

function object(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Row)
    : {};
}

function text(value: unknown, length = 180): string {
  return typeof value === "string" ? value.slice(0, length) : "";
}

function timestamp(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function code(value: unknown): string {
  const candidate = text(value, 80);
  return /^[a-z0-9_./-]+$/i.test(candidate) ? candidate : "";
}

export function deliveryDestinationHost(value: unknown): string {
  const candidate = text(value, 2_000).trim();
  if (!candidate || candidate.startsWith("email:")) return "";
  try {
    const parsed = new URL(
      /^https?:\/\//i.test(candidate) ? candidate : `https://${candidate}`,
    );
    if (!["http:", "https:"].includes(parsed.protocol)) return "";
    return parsed.hostname.toLowerCase();
  } catch {
    return "";
  }
}

const MESSAGES: Record<ApplicationDeliveryState, string> = {
  employer_portal_confirmed: "The submission provider recorded an employer portal confirmation.",
  employer_email_dispatched: "The email provider accepted the application for dispatch to the verified employer address; inbox delivery is not independently confirmed.",
  contractor_confirmed: "The contractor confirmed submission on the employer page.",
  succeeded_without_receipt: "The application is marked successful, but a dated submission receipt is missing.",
  queued: "The approved application is queued for automatic submission.",
  running: "A worker is currently attempting employer submission.",
  worker_lease_expired: "The last worker lease expired; completion is not confirmed.",
  needs_user: "The employer application is paused for the recorded action.",
  failed: "The automatic submission attempt failed without confirmation.",
  cancelled: "This application is no longer scheduled for submission.",
  approval_required: "Contractor approval or a required answer is still missing; submission is not authorised.",
  draft: "The application remains a draft and has not been submitted.",
  approved_without_submission: "The application is approved, but no submission or worker task is recorded.",
  processing_without_worker: "Submission is pending without an active worker task or confirmation.",
};

function latestByApplication(rows: Row[], key: string): Map<string, Row> {
  const latest = new Map<string, Row>();
  for (const row of rows) {
    const applicationId = text(row[key]);
    if (!applicationId) continue;
    const previous = latest.get(applicationId);
    const date = timestamp(row.updated_at) ?? timestamp(row.created_at) ?? "";
    const previousDate = previous
      ? timestamp(previous.updated_at) ?? timestamp(previous.created_at) ?? ""
      : "";
    if (!previous || date > previousDate ||
      (date === previousDate && text(row.id) > text(previous.id)))
      latest.set(applicationId, row);
  }
  return latest;
}

export function classifyApplicationDelivery(input: {
  applicationId: string;
  packet?: Row;
  submission?: Row;
  task?: Row;
  nowMs?: number;
}): ApplicationDeliveryRow {
  const packet = input.packet ?? {};
  const submission = input.submission ?? {};
  const task = input.task ?? {};
  const receipt = object(submission.receipt ?? packet.receipt);
  const review = object(receipt.review);
  const job = object(packet.job_snapshot);
  const questions = Array.isArray(packet.screening_answers)
    ? packet.screening_answers.map(object)
    : [];
  const requiredAnswersMissing = questions.filter((question) =>
    question.required === true &&
    (question.reviewed !== true || !text(question.answer, 10_000).trim()),
  ).length;
  const approvals = {
    truth: packet.truth_approved === true,
    materials: packet.materials_approved === true,
    submission: packet.submission_approved === true,
    requiredAnswersMissing,
    ready: packet.truth_approved === true &&
      packet.materials_approved === true &&
      packet.submission_approved === true && requiredAnswersMissing === 0,
  };
  const submissionStatus = code(submission.status);
  const workerStatus = code(task.status);
  const packetStatus = code(packet.status);
  const action = code(receipt.action ?? review.action);
  const errorCode = code(submission.error_code);
  const submittedAt = timestamp(submission.submitted_at) ??
    timestamp(receipt.createdAt) ?? timestamp(receipt.submittedAt);
  const receiptId = text(receipt.receiptId ?? receipt.providerSubmissionId) ||
    text(submission.provider_submission_id);
  const hasReceipt = Boolean(receiptId && submittedAt &&
    (receipt.mode === "external_handoff" || receipt.state === "submitted"));
  const provider = text(submission.provider_name).toLowerCase();
  let state: ApplicationDeliveryState;
  if (submissionStatus === "succeeded" ||
    (["applied", "viewed", "replied", "interview", "offer", "rejected"].includes(packetStatus) &&
      packet.mode === "external_handoff")) {
    state = !hasReceipt ? "succeeded_without_receipt" :
      provider === "contractor employer-page confirmation" ||
      receiptId.startsWith("contractor-confirmed-") ? "contractor_confirmed" :
      provider === "verified employer email" ? "employer_email_dispatched" :
      "employer_portal_confirmed";
  } else if (submissionStatus === "cancelled" ||
    ["skipped", "withdrawn"].includes(packetStatus)) {
    state = "cancelled";
  } else if (!approvals.ready) {
    state = packetStatus === "draft" && !submissionStatus && !workerStatus
      ? "draft" : "approval_required";
  } else if (workerStatus === "queued") {
    state = "queued";
  } else if (workerStatus === "running") {
    const leaseExpiresAt = timestamp(task.lease_expires_at);
    state = leaseExpiresAt && Date.parse(leaseExpiresAt) <= (input.nowMs ?? Date.now())
      ? "worker_lease_expired" : "running";
  } else if (workerStatus === "needs_user" || receipt.state === "needs_user" || errorCode === "needs_user") {
    state = "needs_user";
  } else if (workerStatus === "failed" || submissionStatus === "failed" || packetStatus === "failed") {
    state = "failed";
  } else if (workerStatus === "cancelled") {
    state = "cancelled";
  } else if (submissionStatus === "processing" || submissionStatus === "queued") {
    state = "processing_without_worker";
  } else {
    state = "approved_without_submission";
  }
  const dates = [timestamp(packet.updated_at), timestamp(submission.updated_at), timestamp(task.updated_at)]
    .filter((value): value is string => Boolean(value)).sort();
  return {
    applicationId: input.applicationId,
    submissionId: text(submission.id),
    taskId: text(task.id),
    jobId: text(packet.job_id) || text(job.id),
    jobTitle: text(job.title),
    companyName: text(job.company_name),
    applyHost: deliveryDestinationHost(task.destination ?? receipt.destination ?? job.apply_url),
    sourceHost: deliveryDestinationHost(job.source_domain),
    state, packetStatus, submissionStatus, workerStatus,
    attempts: Math.max(0, Number(task.attempts) || 0),
    updatedAt: dates.at(-1) ?? null,
    submittedAt,
    availableAt: timestamp(task.available_at),
    leaseExpiresAt: timestamp(task.lease_expires_at),
    action, errorCode,
    message: MESSAGES[state],
    approvals,
  };
}

export function buildApplicationDeliveryReport(input: {
  packets: Row[];
  submissions: Row[];
  tasks: Row[];
  nowMs?: number;
}) {
  const packets = latestByApplication(input.packets, "id");
  const submissions = latestByApplication(input.submissions, "application_id");
  const tasks = latestByApplication(input.tasks, "application_id");
  const applicationIds = new Set([...packets.keys(), ...submissions.keys(), ...tasks.keys()]);
  const rows = [...applicationIds].map((applicationId) => classifyApplicationDelivery({
    applicationId,
    packet: packets.get(applicationId),
    submission: submissions.get(applicationId),
    task: tasks.get(applicationId),
    nowMs: input.nowMs,
  })).sort((left, right) =>
    (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") ||
    left.applicationId.localeCompare(right.applicationId));
  const counts = Object.fromEntries(Object.keys(MESSAGES).map((state) => [state, 0])) as Record<ApplicationDeliveryState, number>;
  const needsUserByAction: Record<string, number> = {};
  for (const row of rows) {
    counts[row.state]++;
    if (row.state === "needs_user" || row.state === "approval_required") {
      const action = row.action || (row.state === "approval_required" ? "contractor_approval" : "unspecified");
      needsUserByAction[action] = (needsUserByAction[action] ?? 0) + 1;
    }
  }
  return {
    totalApplications: rows.length,
    inspectedRows: { packets: input.packets.length, submissions: input.submissions.length, workerTasks: input.tasks.length },
    counts,
    needsUserByAction,
    confirmedByProvider: counts.employer_portal_confirmed + counts.employer_email_dispatched,
    confirmedByContractor: counts.contractor_confirmed,
    automaticPending: counts.queued + counts.running + counts.worker_lease_expired + counts.processing_without_worker,
    rows,
  };
}

/** Range reads never infer a complete table from a capped Supabase response. */
export async function readAllDeliveryRows(
  readPage: (from: number, to: number) => Promise<{ data: Row[] | null; error: unknown }>,
  pageSize = 500,
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += pageSize) {
    const result = await readPage(from, from + pageSize - 1);
    if (result.error) throw result.error;
    const page = result.data ?? [];
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}
