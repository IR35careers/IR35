import { createHash } from "node:crypto";
import type { ApplicationQuestion, ContractorProfile } from "@/lib/workspace/types";
import type { JobDetail } from "@/lib/job-types";
import type { SubmissionProviderReceipt } from "@/lib/application-submission";
import { getTransactionalResend, transactionalEmailConfig } from "@/lib/email/transactional";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[character] ?? character);
}

function safeFileName(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").slice(0, 80) || "candidate";
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function providerIdempotencyKey(value: string): string {
  return `ir35-employer-application-${createHash("sha256").update(value).digest("hex")}`;
}

export async function submitToVerifiedEmployerEmail(input: {
  applicationId: string;
  employerEmail: string;
  job: JobDetail;
  candidate: ContractorProfile;
  candidateName: string;
  resumePdf: Buffer;
  coverLetter: string;
  screeningAnswers: Array<Pick<ApplicationQuestion, "label" | "answer">>;
  idempotencyKey: string;
}): Promise<SubmissionProviderReceipt> {
  const config = transactionalEmailConfig();
  if (!config) throw new Error("Employer email delivery is not configured.");
  if (!isValidEmail(input.candidate.email)) {
    throw new Error("Add a valid email address to your profile before submitting this application.");
  }
  const safeName = escapeHtml(input.candidateName);
  const safeTitle = escapeHtml(input.job.title);
  const safeCompany = escapeHtml(input.job.company_name);
  const safeEmail = escapeHtml(input.candidate.email || "Not supplied");
  const safePhone = escapeHtml(input.candidate.phone || "Not supplied");
  const answerRows = input.screeningAnswers.map((item) => `<tr><td style="padding:10px 0;border-bottom:1px solid #e2e8f0;color:#475569;font-size:13px;line-height:20px"><strong style="display:block;color:#0f172a">${escapeHtml(item.label)}</strong>${escapeHtml(item.answer)}</td></tr>`).join("");
  const coverLetter = escapeHtml(input.coverLetter).replace(/\n/g, "<br>");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a"><div style="display:none;max-height:0;overflow:hidden">Application for ${safeTitle} from ${safeName}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;background:#ffffff;border:1px solid #dbe4ec;border-radius:18px;overflow:hidden"><tr><td style="background:#052e2b;padding:24px 28px;color:#ffffff"><div style="font-size:18px;font-weight:700">IR35Careers</div><div style="margin-top:6px;color:#a7f3d0;font-size:12px;letter-spacing:.08em;text-transform:uppercase">Verified candidate application</div></td></tr><tr><td style="padding:30px 28px"><h1 style="margin:0;font-size:24px;line-height:32px">Application for ${safeTitle}</h1><p style="margin:8px 0 0;color:#64748b;font-size:14px">${safeCompany} · Reference ${escapeHtml(input.applicationId)}</p><div style="margin:24px 0;padding:18px;border-radius:12px;background:#ecfdf5;border:1px solid #a7f3d0"><strong style="font-size:16px">${safeName}</strong><div style="margin-top:6px;color:#475569;font-size:13px">${safeEmail} · ${safePhone}</div></div><h2 style="margin:26px 0 10px;font-size:16px">Cover letter</h2><p style="margin:0;color:#334155;font-size:14px;line-height:22px">${coverLetter}</p><h2 style="margin:26px 0 8px;font-size:16px">Reviewed screening answers</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0">${answerRows}</table><p style="margin:26px 0 0;color:#64748b;font-size:12px;line-height:19px">The candidate reviewed and approved these materials before submission. Their Resume is attached as a PDF. Reply to this email to contact the candidate directly.</p></td></tr><tr><td style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e2e8f0;color:#64748b;font-size:11px;line-height:18px">Sent through IR35Careers after this recruitment destination was verified. Privacy information: https://www.ir35careers.com/privacy</td></tr></table></td></tr></table></body></html>`;
  const text = [
    "IR35Careers verified candidate application",
    "",
    `Role: ${input.job.title}`,
    `Company: ${input.job.company_name}`,
    `Application reference: ${input.applicationId}`,
    "",
    `Candidate: ${input.candidateName}`,
    `Email: ${input.candidate.email || "Not supplied"}`,
    `Phone: ${input.candidate.phone || "Not supplied"}`,
    "",
    "Cover letter",
    input.coverLetter,
    "",
    "Reviewed screening answers",
    ...input.screeningAnswers.flatMap((item) => [item.label, item.answer, ""]),
    "The candidate reviewed and approved these materials before submission. Their Resume is attached as a PDF.",
  ].join("\n");
  const delivery = await getTransactionalResend(config).emails.send({
    from: config.from,
    to: [input.employerEmail],
    subject: `${input.candidateName} application for ${input.job.title}`.slice(0, 150),
    html,
    text,
    replyTo: input.candidate.email,
    attachments: [{ filename: `${safeFileName(input.candidateName)}-Resume.pdf`, content: input.resumePdf }],
    headers: { "X-Entity-Ref-ID": input.idempotencyKey },
    tags: [{ name: "email_type", value: "employer_application" }],
  }, { idempotencyKey: providerIdempotencyKey(input.idempotencyKey) });
  if (delivery.error || !delivery.data?.id) throw new Error(delivery.error?.message || "The employer application email was not accepted for delivery.");
  return {
    state: "submitted",
    providerSubmissionId: delivery.data.id,
    submittedAt: new Date().toISOString(),
    message: "Application delivered to the employer's verified recruitment address.",
  };
}
