import { z } from "zod";
import { STAGING_TEST_ACCOUNT } from "./mock-config";

export const MOCK_WEB_QUEUE = "ir35-staging-web-mock-apply";
export const MOCK_WEB_SCENARIOS = ["success", "server_error", "timeout", "lost_ack", "captcha", "unknown_answer"] as const;
export const mockWebScenarioSchema = z.enum(MOCK_WEB_SCENARIOS);
export type MockWebScenario = z.infer<typeof mockWebScenarioSchema>;

// Opaque identifiers/version only. No email, CV, URL or credentials.
export const mockWebKickSchema = z.strictObject({
  kind: z.literal("staging_web_mock_delivery"),
  applicationId: z.uuid(), jobId: z.uuid(), deliveryVersion: z.number().int().positive(), requestedAt: z.iso.datetime(),
});
export type MockWebKick = z.infer<typeof mockWebKickSchema>;

const configuration = z.object({
  IR35_MOCK_WEB_ENABLED: z.literal("true"), IR35_STAGING: z.literal("true"), APPLY_RUNNER: z.literal("mock"),
  APPLICATION_WORKER_ACCEPT_JOBS: z.literal("false"), IR35_READ_ONLY: z.literal("false"),
  APPLICATION_WORKER_CONCURRENCY: z.literal("1"),
  IR35_SCHEDULER_ENABLED: z.literal("false"),
  APPLICATION_WORKER_SECRET: z.string().min(32).max(256),
  IR35CAREERS_APP_URL: z.literal("https://staging.ir35careers.com"),
  IR35_MOCK_WEB_JOB_IDS: z.string().min(1).max(250),
});
const liveProvider = /^(?:STRIPE_|RESEND_|POSTMARK_|EMAIL_PROVIDER_|TSENTA_|APPLICATION_SUBMISSION_PROVIDER_|SMTP_|GOTRUE_SMTP_(?:USER|PASS)$|GOTRUE_EXTERNAL_(?:GOOGLE|GITHUB)_SECRET$|OPENAI_|OPENROUTER_|AWS_|GOOGLE_|GITHUB_CLIENT_SECRET$|GH_TOKEN$|GITHUB_TOKEN$)/;

export type MockWebPolicy = {
  jobIds: readonly string[]; scenarioFor: (jobId: string) => MockWebScenario;
};

/** This config does not enable the existing normal consumer, change acceptance,
 * or waive the separately verified container/network/private-DB fixture guards.
 */
export function mockWebPolicy(env: Record<string, string | undefined> = process.env): MockWebPolicy | null {
  if (env.IR35_MOCK_WEB_ENABLED === undefined || env.IR35_MOCK_WEB_ENABLED === "false") return null;
  const parsed = configuration.safeParse(env);
  if (!parsed.success || env.VERCEL || Object.entries(env).some(([key, value]) => Boolean(value) && liveProvider.test(key)))
    throw new Error("The staging web mock bridge requires its isolated, provider-free fixture and acceptance=false.");
  const ids = parsed.data.IR35_MOCK_WEB_JOB_IDS.split(",");
  if (ids.length !== 6 || ids.some(id => id !== id.toLowerCase() || !z.uuid().safeParse(id).success) || new Set(ids).size !== 6)
    throw new Error("Exactly six unique server-owned mock job identifiers are required.");
  const scenarios = new Map(ids.map((id, index) => [id, MOCK_WEB_SCENARIOS[index]!]));
  return { jobIds: Object.freeze([...ids]), scenarioFor(jobId) {
    const scenario = scenarios.get(jobId);
    if (!scenario) throw new Error("This contract is not an owned staging mock fixture.");
    return scenario;
  } };
}

/** Call only with the authenticated server account and stored packet owner/job,
 * never identities supplied by a request body. URLs/data never leave the app.
 */
export function requireMockWebActor(policy: MockWebPolicy, input: unknown): { applicationId: string; jobId: string; scenario: MockWebScenario } {
  const parsed = z.strictObject({ accountEmail: z.literal(STAGING_TEST_ACCOUNT), userId: z.uuid(),
    packetUserId: z.uuid(), applicationId: z.uuid(), jobId: z.uuid() }).safeParse(input);
  if (!parsed.success || parsed.data.userId !== parsed.data.packetUserId)
    throw new Error("Only the named staging test account may use its own mock application.");
  return { applicationId: parsed.data.applicationId, jobId: parsed.data.jobId,
    scenario: policy.scenarioFor(parsed.data.jobId) };
}

const mockWebWorkerId = z.string().refine(value => value.startsWith("staging-web-mock-") && z.uuid().safeParse(value.slice(17)).success);
export const mockWebClaimSchema = z.strictObject({
  kind: z.literal("staging_web_mock_claim"), applicationId: z.uuid(), jobId: z.uuid(), deliveryVersion: z.number().int().positive(),
  workerId: mockWebWorkerId, recoverLease: z.boolean().optional(),
});
export const mockWebHeartbeatSchema = z.strictObject({
  kind: z.literal("staging_web_mock_heartbeat"), workerId: mockWebWorkerId, startedAt: z.iso.datetime(),
  active: z.number().int().min(0).max(1), completed: z.number().int().nonnegative(), failed: z.number().int().nonnegative(),
  buildSha: z.string().regex(/^[a-f0-9]{40}$/),
});
export const mockWebClaimOrHeartbeatSchema = z.union([mockWebClaimSchema, mockWebHeartbeatSchema]);
export const mockWebAssignmentSchema = z.strictObject({
  applicationId: z.uuid(), taskId: z.uuid(), attempt: z.number().int().positive(), scenario: mockWebScenarioSchema,
});
export const mockWebResultSchema = z.strictObject({
  kind: z.literal("staging_web_mock_result"), applicationId: z.uuid(), taskId: z.uuid(),
  attempt: z.number().int().positive(), outcome: z.enum(["submitted", "failed"]),
  failure: z.enum(["mock_ats_http_500", "mock_ats_timeout", "mock_unknown_outcome", "mock_captcha_required",
    "mock_input_required", "mock_browser_failed", "runner_timeout"]).nullable(),
  mockReceiptConfirmed: z.boolean(),
}).superRefine((value, ctx) => {
  if ((value.outcome === "submitted") !== value.mockReceiptConfirmed
    || (value.outcome === "submitted" ? value.failure !== null : value.failure === null))
    ctx.addIssue({ code: "custom", message: "Explicit mock confirmation or failure is required." });
});
