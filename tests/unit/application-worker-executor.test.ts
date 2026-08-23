import { describe, expect, it } from "vitest";
import { executeApplicationWorkerAssignment } from "@/lib/application-worker-executor";

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
