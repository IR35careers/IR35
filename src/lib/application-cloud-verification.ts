import { applicationWorkerAppOrigin } from "@/lib/application-worker-auth";
import { createApplicationRunnerTestToken } from "@/lib/application-runner/test-token";
import { runNativeApplication } from "@/lib/application-runner/run";
import { DEMO_JOBS } from "@/lib/demo-jobs";
import { SAMPLE_CONTRACTOR_PROFILE } from "@/lib/workspace/seed";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

/** Exercise only our controlled portal; never create a customer submission. */
export async function verifyCloudApplicationRuntime(kickId: string) {
  const origin = applicationWorkerAppOrigin(process.env.IR35CAREERS_APP_URL);
  const destination = `${origin}/testing/application-form?token=${encodeURIComponent(createApplicationRunnerTestToken())}`;
  const receipt = await runNativeApplication({
    applicationId: kickId,
    destination,
    job: { ...DEMO_JOBS[0], title: "Platform Engineer controlled runner test", company_name: "IR35Careers Test Portal", apply_url: destination, source_domain: new URL(origin).hostname },
    candidate: { ...SAMPLE_CONTRACTOR_PROFILE, fullName: "Alex Morgan", email: "runner-test@mail.ir35careers.com", phone: "+447700900000", portalAccountConsent: true, automaticEmailVerification: true, employerTermsConsent: true },
    resume: { label: "Controlled verification Resume", text: "Alex Morgan\nPlatform Engineer\nAWS, Terraform, Kubernetes and CI/CD delivery experience.\nExperience: Built and operated cloud platforms for UK organisations." },
    coverLetter: "I am applying for this controlled Platform Engineer test. My approved evidence covers AWS, Terraform, Kubernetes and CI/CD delivery. Kind regards, Alex Morgan",
    screeningAnswers: [{ label: "Are you authorised to work in the UK?", answer: "Yes", source: "user" }, { label: "Do you need visa sponsorship?", answer: "No", source: "user" }],
  }, { budgetMs: 180_000, portalPassword: "Ir35!ControlledRunner7", resolvePortalPassword: async () => "Ir35!ControlledRunner7", resolveEmailVerificationCode: async () => "482731" });
  const action = receipt.review && typeof receipt.review === "object" ? String((receipt.review as Record<string, unknown>).action || "") : "";
  const summary = { kickId, state: receipt.state, action: action || null, message: receipt.message.slice(0, 500), execution: "managed_cloud_queue", deviceRequired: false, testedAt: new Date().toISOString() };
  const result = await getSupabaseAdmin().from("moderation_logs").insert({ run_type: "cloud_worker_verification", summary });
  if (result.error) throw new Error("The cloud verification result could not be recorded.");
  console.info("cloud_worker_verification", summary);
  if (receipt.state !== "submitted") throw new Error("The controlled cloud browser did not return a submission receipt.");
}
