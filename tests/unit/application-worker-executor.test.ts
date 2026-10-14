import { afterEach, describe, expect, it, vi } from "vitest";
import {
  executeApplicationWorkerAssignment,
  postApplicationWorkerCallback,
} from "@/lib/application-worker-executor";
import { ApplicationRunnerPreSubmitError } from "@/lib/application-runner/failure";

const native = vi.hoisted(() => vi.fn());
vi.mock("@/lib/application-runner/run", () => ({ runNativeApplication: native }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("application worker preflight", () => {
  it("returns a needs-user continuation instead of recording a failed run", async () => {
    const callback = await executeApplicationWorkerAssignment({
      assignment: {
        task: {
          id: "50bfbf67-bac9-4606-ab9d-020815496e6a",
          user_id: "749495cc-f9f0-48c3-9a56-2af9a7139ec0",
          application_id: "a497269d-d5df-423a-9ff5-f68250b94ea8",
          idempotency_key:
            "submit:a497269d-d5df-423a-9ff5-f68250b94ea8",
          destination: "https://example.com/apply",
          callback_url:
            "https://www.ir35careers.com/api/applications/worker/callback",
          status: "running",
          attempts: 1,
        },
        preflightError:
          "Allow employer account creation before this application starts.",
        preflightAction: "employer_terms",
      },
      appOrigin: "https://www.ir35careers.com",
    });

    expect(callback.error).toBeUndefined();
    expect(callback.receipt).toMatchObject({
      state: "needs_user",
      message:
        "Allow employer account creation before this application starts.",
      review: { action: "employer_terms" },
    });
  });
});

describe("accepted worker callback outcomes", () => {
  it("carries a proven pre-submit failure through the signed callback protocol", async () => {
    native.mockRejectedValueOnce(new ApplicationRunnerPreSubmitError(new Error("Controlled navigation failure")));
    const callback = await executeApplicationWorkerAssignment({
      appOrigin: "https://www.ir35careers.com",
      assignment: {
        task: { id: "task", application_id: "app", user_id: "owner", idempotency_key: "key", attempts: 2,
          status: "running", destination: "https://example.test/apply", callback_url: "https://www.ir35careers.com/api/applications/worker/callback" },
        payload: { candidate: { automaticEmailVerification: false, portalAccountConsent: false } } as never,
      },
    });
    expect(callback).toMatchObject({ retryable: true, workerAttempt: 2, error: "Controlled navigation failure" });
    expect(callback.receipt).toBeUndefined();
  });
  it("returns the persisted retry state instead of counting an attention receipt as submitted", async () => {
    vi.stubEnv("APPLICATION_WORKER_SECRET", "worker-test-secret-at-least-32-characters");
    const callbackFetch = vi.fn().mockResolvedValue(
      Response.json({ ok: true, state: "processing" }),
    );
    vi.stubGlobal("fetch", callbackFetch);
    const task = {
      id: "50bfbf67-bac9-4606-ab9d-020815496e6a",
      user_id: "749495cc-f9f0-48c3-9a56-2af9a7139ec0",
      application_id: "a497269d-d5df-423a-9ff5-f68250b94ea8",
      idempotency_key: "submit:a497269d-d5df-423a-9ff5-f68250b94ea8",
      destination: "https://example.com/apply",
      callback_url: "https://www.ir35careers.com/api/applications/worker/callback",
      status: "running" as const,
      attempts: 1,
    };
    const saved = await postApplicationWorkerCallback({
      task,
      appOrigin: "https://www.ir35careers.com",
      callback: {
        taskId: task.id,
        userId: task.user_id,
        applicationId: task.application_id,
        idempotencyKey: task.idempotency_key,
        completedAt: "2026-10-13T12:00:00.000Z",
        receipt: {
          state: "needs_user",
          providerSubmissionId: "retryable-provider-result",
          submittedAt: "2026-10-13T12:00:00.000Z",
          message: "The employer portal needs another automatic attempt.",
        },
      },
    });

    expect(saved).toEqual({ ok: true, state: "processing" });
    expect(callbackFetch).toHaveBeenCalledOnce();
  });
});
