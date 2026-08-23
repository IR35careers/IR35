import { createHash } from "node:crypto";
import { buildApplicationAttention } from "@/lib/application-attention";
import {
  clearApplicationBrowserHandoff,
  createApplicationBrowserHandoff,
  loadApplicationBrowserHandoff,
} from "@/lib/application-browser-handoff";
import { applicationPortalPassword } from "@/lib/application-portal-account";
import { buildRunnerFacts } from "@/lib/application-runner/types";
import { normaliseCoverLetterSignoff, resolveCandidateName } from "@/lib/candidate-name";
import {
  applicationInboxAlias,
  ensureInboxAlias,
} from "@/lib/email/inbox-alias";
import { sendApplicationNotification } from "@/lib/email/application-notifications";
import { extractEmailVerificationCode } from "@/lib/email/verification-code";
import { buildResumePdf } from "@/lib/resume/export";
import { normaliseResumeText } from "@/lib/resume/normalise-text";
import { loadPortalSession } from "@/lib/application-portal-session";
import { readJsonBody, RequestBodyError } from "@/lib/security/request-body";
import { validatePublicHttpsUrl } from "@/lib/security/public-url";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type {
  ApplicationQuestion,
  ApplicationReceipt,
  ContractorProfile,
} from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";

export const runtime = "nodejs";
export const maxDuration = 60;

const EXTENSION_ID = "cmfcgaflmkipmmjkcneoobgkdpfkfeoa";
const EXTENSION_ORIGIN = `chrome-extension://${EXTENSION_ID}`;
const NO_STORE = {
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
};

type AdminClient = ReturnType<typeof getSupabaseAdmin>;
type DbRow = Record<string, unknown>;

function corsHeaders(request: Request): Record<string, string> {
  return request.headers.get("origin") === EXTENSION_ORIGIN
    ? {
        "Access-Control-Allow-Origin": EXTENSION_ORIGIN,
        "Access-Control-Allow-Headers": "Content-Type, X-IR35-Handoff",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        Vary: "Origin",
      }
    : {};
}

function headers(request: Request): Record<string, string> {
  return { ...NO_STORE, ...corsHeaders(request) };
}

function approved(row: DbRow): boolean {
  const questions = (row.screening_answers as ApplicationQuestion[]) ?? [];
  return Boolean(
    row.truth_approved &&
      row.materials_approved &&
      questions.every(
        (question) =>
          !question.answer.trim() || question.reviewed,
      ),
  );
}

function clean(value: unknown, max = 500): string {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function handoffToken(request: Request): string {
  const url = new URL(request.url);
  return clean(
    request.headers.get("x-ir35-handoff") || url.searchParams.get("token"),
    80,
  );
}

function mergeQuestions(
  current: ApplicationQuestion[],
  incoming: ApplicationQuestion[],
): ApplicationQuestion[] {
  const merged = [...current];
  for (const question of incoming) {
    const index = merged.findIndex(
      (item) =>
        item.id === question.id ||
        item.label.toLowerCase() === question.label.toLowerCase(),
    );
    if (index < 0) merged.push(question);
    else
      merged[index] = {
        ...merged[index],
        ...question,
        answer: question.answer.trim() || merged[index].answer,
        reviewed: Boolean(question.answer.trim()) || merged[index].reviewed,
      };
  }
  return merged.slice(0, 100);
}

function browserQuestions(value: unknown): ApplicationQuestion[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 30)
    .map((item, index) => {
      const row = item && typeof item === "object" ? (item as DbRow) : {};
      const label = clean(row.label, 500) || `Employer question ${index + 1}`;
      const answer = clean(row.answer, 2_000);
      const idValue = clean(row.id, 200) || createHash("sha256").update(label).digest("hex").slice(0, 18);
      return {
        id: `browser:${idValue}`,
        label,
        answer,
        required: row.required !== false,
        source: answer ? ("user" as const) : ("job" as const),
        reviewed: Boolean(answer),
      };
    })
    .filter((question) => question.label.length > 0);
}

async function applicationContext(admin: AdminClient, userId: string, applicationId: string) {
  const [{ data: packet, error: packetError }, { data: profileRow, error: profileError }] =
    await Promise.all([
      admin
        .from("application_packets")
        .select("*")
        .eq("id", applicationId)
        .eq("user_id", userId)
        .maybeSingle(),
      admin
        .from("profiles")
        .select("application_profile")
        .eq("id", userId)
        .maybeSingle(),
    ]);
  if (packetError || profileError)
    throw new Error(packetError?.message || profileError?.message);
  if (!packet) throw new Error("Application packet was not found.");
  const userResult = await admin.auth.admin.getUserById(userId);
  if (userResult.error || !userResult.data.user)
    throw new Error("The contractor account is unavailable.");
  return {
    packet: packet as DbRow,
    profile: (profileRow?.application_profile ?? {}) as ContractorProfile,
    authUser: userResult.data.user,
    job: packet.job_snapshot as JobDetail,
  };
}

async function createHandoff(request: Request, applicationId: string): Promise<Response> {
  const authorization = request.headers.get("authorization") ?? "";
  const accessToken = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";
  if (!accessToken)
    return Response.json(
      { error: "Sign in again before continuing this application." },
      { status: 401, headers: headers(request) },
    );
  const admin = getSupabaseAdmin();
  const authResult = await admin.auth.getUser(accessToken);
  const authUser = authResult.data.user;
  if (authResult.error || !authUser)
    return Response.json(
      { error: "Your session expired. Sign in again, then retry." },
      { status: 401, headers: headers(request) },
    );
  const context = await applicationContext(admin, authUser.id, applicationId);
  if (!approved(context.packet))
    return Response.json(
      { error: "Review and approve the final application before continuing." },
      { status: 409, headers: headers(request) },
    );
  let destination = await validatePublicHttpsUrl(context.job.apply_url);
  const savedPortal = await loadPortalSession({
    admin,
    userId: authUser.id,
    applicationId,
  }).catch(() => null);
  if (savedPortal?.currentUrl) {
    try {
      destination = await validatePublicHttpsUrl(savedPortal.currentUrl);
    } catch {
      // Fall back to the approved job destination if the saved employer step
      // is no longer a valid public HTTPS page.
    }
  }
  const created = await createApplicationBrowserHandoff({
    admin,
    userId: authUser.id,
    applicationId,
    destination: destination.toString(),
  });
  const idempotencyKey = `submit:${applicationId}`;
  const now = new Date().toISOString();
  const payloadHash = createHash("sha256")
    .update(`${applicationId}:${context.packet.updated_at}:${destination}`)
    .digest("hex");
  const [{ error: submissionError }, { error: eventError }] = await Promise.all([
    admin.from("application_submissions").upsert(
      {
        user_id: authUser.id,
        application_id: applicationId,
        provider_name: "IR35Careers browser assistant",
        provider_submission_id: null,
        idempotency_key: idempotencyKey,
        payload_hash: payloadHash,
        status: "processing",
        error_code: null,
        receipt: {
          state: "processing",
          message: "The approved application is continuing in your secure browser.",
        },
        submitted_at: null,
        updated_at: now,
      },
      { onConflict: "user_id,idempotency_key" },
    ),
    admin.from("application_events").upsert(
      {
        user_id: authUser.id,
        application_id: applicationId,
        event_type: "status_changed",
        label: "Secure browser continuation started",
        metadata: { destinationHost: destination.hostname },
        idempotency_key: `${idempotencyKey}:browser-handoff:${created.record.createdAt}`,
      },
      { onConflict: "user_id,idempotency_key" },
    ),
  ]);
  if (submissionError || eventError)
    throw new Error(submissionError?.message || eventError?.message);
  destination.hash = `ir35careers-apply=${encodeURIComponent(created.token)}`;
  return Response.json(
    {
      handoffUrl: destination.toString(),
      expiresAt: created.record.expiresAt,
      extensionId: EXTENSION_ID,
    },
    { status: 201, headers: headers(request) },
  );
}

async function packetResponse(request: Request, token: string): Promise<Response> {
  const admin = getSupabaseAdmin();
  const handoff = await loadApplicationBrowserHandoff({ admin, token, claim: true });
  if (!handoff)
    return Response.json(
      { error: "This browser continuation expired. Return to IR35Careers and start it again." },
      { status: 410, headers: headers(request) },
    );
  const context = await applicationContext(admin, handoff.userId, handoff.applicationId);
  if (!approved(context.packet))
    return Response.json(
      { error: "This application needs to be reviewed again in IR35Careers." },
      { status: 409, headers: headers(request) },
    );
  const resumeText = normaliseResumeText(
    String(context.packet.tailored_cv_text || context.packet.source_cv_text || ""),
  );
  const candidateName = resolveCandidateName(context.profile.fullName || "", resumeText);
  if (!candidateName)
    return Response.json(
      { error: "Add your full name to your IR35Careers profile first." },
      { status: 409, headers: headers(request) },
    );
  const accountEmail = context.authUser.email || context.profile.email || "";
  const inbox = await ensureInboxAlias(admin, handoff.userId, accountEmail, true);
  const candidate: ContractorProfile = {
    ...context.profile,
    fullName: candidateName,
    email: inbox?.alias
      ? applicationInboxAlias(inbox.alias, handoff.applicationId)
      : context.profile.email || accountEmail,
  };
  const questions = (context.packet.screening_answers as ApplicationQuestion[]) ?? [];
  const resumePdf = await buildResumePdf({
    format: "pdf",
    resumeText,
    candidateName,
    jobTitle: context.job.title,
    companyName: context.job.company_name,
    versionLabel: String(context.packet.resume_version_label || "Application CV"),
  });
  const facts = buildRunnerFacts(candidate, questions);
  return Response.json(
    {
      applicationId: handoff.applicationId,
      destination: handoff.destination,
      job: {
        title: context.job.title,
        company: context.job.company_name,
      },
      facts,
      coverLetter: normaliseCoverLetterSignoff(
        String(context.packet.cover_letter || ""),
        candidateName,
      ),
      resume: {
        filename: `${context.job.title.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "application"}-CV.pdf`,
        mimeType: "application/pdf",
        base64: resumePdf.toString("base64"),
      },
      account: {
        enabled: Boolean(candidate.portalAccountConsent),
        email: candidate.email,
        password: candidate.portalAccountConsent
          ? applicationPortalPassword(handoff.userId, handoff.destination)
          : undefined,
        automaticEmailVerification: Boolean(candidate.automaticEmailVerification),
        employerTermsConsent: Boolean(candidate.employerTermsConsent),
      },
      expiresAt: handoff.expiresAt,
    },
    { headers: headers(request) },
  );
}

async function verificationResponse(request: Request, token: string): Promise<Response> {
  const admin = getSupabaseAdmin();
  const handoff = await loadApplicationBrowserHandoff({ admin, token });
  if (!handoff)
    return Response.json({ error: "Browser continuation expired." }, { status: 410, headers: headers(request) });
  const since = new Date(Math.max(new Date(handoff.createdAt).getTime() - 5 * 60_000, Date.now() - 20 * 60_000)).toISOString();
  const { data, error } = await admin
    .from("inbox_messages")
    .select("application_id, subject, body_text, received_at")
    .eq("user_id", handoff.userId)
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(30);
  if (error) throw new Error(error.message);
  for (const row of data ?? []) {
    if (row.application_id && String(row.application_id) !== handoff.applicationId) continue;
    const code = extractEmailVerificationCode(String(row.subject ?? ""), String(row.body_text ?? ""));
    if (code)
      return Response.json({ code, receivedAt: row.received_at }, { headers: headers(request) });
  }
  return Response.json({ code: null }, { headers: headers(request) });
}

async function saveBrowserAnswers(input: {
  admin: AdminClient;
  handoff: NonNullable<Awaited<ReturnType<typeof loadApplicationBrowserHandoff>>>;
  questions: ApplicationQuestion[];
}): Promise<void> {
  if (!input.questions.length) return;
  const { data: packet, error } = await input.admin
    .from("application_packets")
    .select("screening_answers")
    .eq("id", input.handoff.applicationId)
    .eq("user_id", input.handoff.userId)
    .maybeSingle();
  if (error || !packet) throw new Error(error?.message || "Application packet was not found.");
  const merged = mergeQuestions(
    (packet.screening_answers as ApplicationQuestion[]) ?? [],
    input.questions,
  );
  const update = await input.admin
    .from("application_packets")
    .update({
      screening_answers: merged,
      submission_approved: merged.every(
        (question) =>
          !question.required || (question.reviewed && question.answer.trim()),
      ),
      updated_at: new Date().toISOString(),
    })
    .eq("id", input.handoff.applicationId)
    .eq("user_id", input.handoff.userId);
  if (update.error) throw new Error(update.error.message);
}

async function reportResult(request: Request, body: DbRow): Promise<Response> {
  const token = clean(body.token, 80) || handoffToken(request);
  const admin = getSupabaseAdmin();
  const handoff = await loadApplicationBrowserHandoff({ admin, token });
  if (!handoff)
    return Response.json({ error: "Browser continuation expired." }, { status: 410, headers: headers(request) });
  const context = await applicationContext(admin, handoff.userId, handoff.applicationId);
  const status = clean(body.status, 40);
  const questions = browserQuestions(body.questions);
  if (status === "answers") {
    await saveBrowserAnswers({ admin, handoff, questions });
    return Response.json({ ok: true }, { headers: headers(request) });
  }
  const idempotencyKey = `submit:${handoff.applicationId}`;
  const now = new Date().toISOString();
  const resumeText = normaliseResumeText(
    String(context.packet.tailored_cv_text || context.packet.source_cv_text || ""),
  );
  const candidateName = resolveCandidateName(context.profile.fullName || "", resumeText) || "Contractor";
  const inbox = await ensureInboxAlias(
    admin,
    handoff.userId,
    context.authUser.email || context.profile.email || "",
    true,
  );
  const notificationEmail = inbox?.forwardingEmail || context.authUser.email || context.profile.email;

  if (status === "submitted") {
    const confirmation = clean(body.confirmation, 1_000);
    if (!/(thank|received|submitted|success|application complete|application has been sent)/i.test(confirmation))
      return Response.json(
        { error: "Employer confirmation was not detected. The application has not been marked Applied." },
        { status: 409, headers: headers(request) },
      );
    let destination = handoff.destination;
    try {
      destination = (await validatePublicHttpsUrl(clean(body.url, 2_000) || handoff.destination)).toString();
    } catch {
      destination = handoff.destination;
    }
    const providerSubmissionId = `ir35-browser-${createHash("sha256")
      .update(`${handoff.applicationId}:${confirmation}:${destination}`)
      .digest("hex")
      .slice(0, 18)}`;
    const receipt: ApplicationReceipt = {
      receiptId: providerSubmissionId,
      mode: "external_handoff",
      createdAt: now,
      destination,
      reviewedFields: ["cv", "cover_letter", "screening_answers", "destination"],
      skippedFields: [],
      message: confirmation,
    };
    const [{ error: submissionError }, { error: packetError }, { error: eventError }] =
      await Promise.all([
        admin
          .from("application_submissions")
          .update({
            status: "succeeded",
            provider_name: "IR35Careers browser assistant",
            provider_submission_id: providerSubmissionId,
            receipt,
            error_code: null,
            submitted_at: now,
            updated_at: now,
          })
          .eq("user_id", handoff.userId)
          .eq("idempotency_key", idempotencyKey),
        admin
          .from("application_packets")
          .update({ status: "applied", mode: "external_handoff", receipt, updated_at: now })
          .eq("id", handoff.applicationId)
          .eq("user_id", handoff.userId),
        admin.from("application_events").upsert(
          {
            user_id: handoff.userId,
            application_id: handoff.applicationId,
            event_type: "status_changed",
            label: "Application submitted successfully",
            metadata: { providerSubmissionId, destination, confirmation },
            idempotency_key: `${idempotencyKey}:browser-submitted`,
          },
          { onConflict: "user_id,idempotency_key" },
        ),
      ]);
    if (submissionError || packetError || eventError)
      throw new Error(submissionError?.message || packetError?.message || eventError?.message);
    if (notificationEmail)
      await sendApplicationNotification({
        kind: "submitted",
        to: notificationEmail,
        userId: handoff.userId,
        inboxAlias: inbox?.alias,
        candidateName,
        jobTitle: context.job.title,
        companyName: context.job.company_name,
        jobId: context.job.id,
        applicationId: handoff.applicationId,
        idempotencyKey: `${idempotencyKey}:browser-submitted`,
      }).catch(() => null);
    await clearApplicationBrowserHandoff({ admin, token });
    return Response.json({ ok: true, state: "submitted", receipt }, { headers: headers(request) });
  }

  if (status === "needs_user") {
    await saveBrowserAnswers({ admin, handoff, questions });
    const action = clean(body.action, 80) || (questions.length ? "/profile" : "unsupported_form");
    const message = clean(body.message, 1_000) || "The employer needs one more item before the application can continue.";
    const current = (context.packet.screening_answers as ApplicationQuestion[]) ?? [];
    const merged = mergeQuestions(current, questions);
    const attention = buildApplicationAttention({ action, message, questions: merged });
    const [{ error: submissionError }, { error: packetError }, { error: eventError }] =
      await Promise.all([
        admin
          .from("application_submissions")
          .update({
            status: "processing",
            provider_name: "IR35Careers browser assistant",
            error_code: "needs_user",
            receipt: { state: "needs_user", action, message, attention, review: { questions } },
            updated_at: now,
          })
          .eq("user_id", handoff.userId)
          .eq("idempotency_key", idempotencyKey),
        admin
          .from("application_packets")
          .update({
            status: "needs_review",
            screening_answers: merged,
            submission_approved: questions.some((question) => question.required && !question.reviewed)
              ? false
              : Boolean(context.packet.submission_approved),
            updated_at: now,
          })
          .eq("id", handoff.applicationId)
          .eq("user_id", handoff.userId),
        admin.from("application_events").upsert(
          {
            user_id: handoff.userId,
            application_id: handoff.applicationId,
            event_type: "status_changed",
            label: "Employer page needs your action",
            metadata: { action, attention, questionCount: questions.length },
            idempotency_key: `${idempotencyKey}:browser-needs-user:${createHash("sha256").update(`${action}:${message}`).digest("hex").slice(0, 16)}`,
          },
          { onConflict: "user_id,idempotency_key" },
        ),
      ]);
    if (submissionError || packetError || eventError)
      throw new Error(submissionError?.message || packetError?.message || eventError?.message);
    if (notificationEmail)
      await sendApplicationNotification({
        kind: "needs_attention",
        to: notificationEmail,
        userId: handoff.userId,
        inboxAlias: inbox?.alias,
        candidateName,
        jobTitle: context.job.title,
        companyName: context.job.company_name,
        jobId: context.job.id,
        applicationId: handoff.applicationId,
        idempotencyKey: `${idempotencyKey}:browser-needs-user:${action}`,
      }).catch(() => null);
    return Response.json({ ok: true, state: "needs_user", attention }, { headers: headers(request) });
  }

  return Response.json({ error: "Unsupported browser result." }, { status: 400, headers: headers(request) });
}

export function OPTIONS(request: Request): Response {
  return new Response(null, { status: 204, headers: headers(request) });
}

export async function GET(request: Request): Promise<Response> {
  try {
    const token = handoffToken(request);
    const kind = new URL(request.url).searchParams.get("kind") || "packet";
    return kind === "verification"
      ? await verificationResponse(request, token)
      : await packetResponse(request, token);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Browser continuation failed." },
      { status: 502, headers: headers(request) },
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const body = await readJsonBody<DbRow>(request, 150_000);
    const action = clean(body.action, 40) || "create";
    if (action === "create") {
      const applicationId = clean(body.applicationId, 80);
      if (!/^[0-9a-f-]{36}$/i.test(applicationId))
        return Response.json({ error: "Application reference is invalid." }, { status: 400, headers: headers(request) });
      return await createHandoff(request, applicationId);
    }
    if (action === "result") return await reportResult(request, body);
    return Response.json({ error: "Unsupported browser action." }, { status: 400, headers: headers(request) });
  } catch (error) {
    if (error instanceof RequestBodyError)
      return Response.json({ error: error.message }, { status: error.status, headers: headers(request) });
    return Response.json(
      { error: error instanceof Error ? error.message : "Browser continuation failed." },
      { status: 502, headers: headers(request) },
    );
  }
}
