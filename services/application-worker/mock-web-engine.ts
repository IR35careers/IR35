import { z } from "zod";
import { mockWebAssignmentSchema, mockWebKickSchema, mockWebResultSchema, type MockWebKick } from "../../src/lib/queue/mock-web-policy";
import { MOCK_WEB_CLAIM_PATH, MOCK_WEB_CALLBACK_PATH } from "../../src/lib/queue/mock-web-http";
import type { WebMockLedger, WebMockResult } from "./mock-web-store";

const browserResult = z.object({ ok: z.boolean(), receiptConfirmed: z.boolean().optional(),
  submissions: z.number().int().min(0).max(1), errorCode: mockWebResultSchema.shape.failure.optional() });
const acknowledgement = z.object({ ok: z.literal(true), duplicate: z.boolean().optional() });
export interface WebMockDependencies {
  ledger: WebMockLedger;
  post: (path: string, value: unknown) => Promise<unknown>;
  browser: (scenario: z.infer<typeof mockWebAssignmentSchema>["scenario"]) => Promise<unknown>;
  browserLease: () => Promise<{ release: () => Promise<void> }>;
}

/** Only server-issued mock scenario names enter Chromium. A committed start
 * marker is written BEFORE the child runs. Crash/unknown outcomes are failed,
 * never re-submitted; durable callback redelivery never re-runs a browser.
 */
export async function processWebMockDelivery(input: unknown, deps: WebMockDependencies): Promise<void> {
  const kick: MockWebKick = mockWebKickSchema.parse(input);
  let record = await deps.ledger.remember(kick);
  if (record.state === "acknowledged" || record.state === "superseded") return;
  if (record.state === "queued") {
    const response = z.strictObject({ assignment: mockWebAssignmentSchema.nullable() }).parse(await deps.post(MOCK_WEB_CLAIM_PATH, {
      kind: "staging_web_mock_claim", applicationId: kick.applicationId, jobId: kick.jobId, deliveryVersion: kick.deliveryVersion,
      workerId: record.workerId, recoverLease: true,
    }));
    if (!response.assignment) { await deps.ledger.supersede(kick); return; }
    if (response.assignment.applicationId !== kick.applicationId) throw new Error("Mock control assignment identity mismatch.");
    await deps.ledger.claim(kick, response.assignment);
    record = await deps.ledger.remember(kick);
  }
  if (record.state === "claimed" || record.state === "started") {
    if (!record.assignment) throw new Error("Mock attempt has no saved claim.");
    const assignment = record.assignment;
    let outcome: WebMockResult = { kind: "staging_web_mock_result", applicationId: kick.applicationId,
      taskId: assignment.taskId, attempt: assignment.attempt, outcome: "failed", failure: "mock_unknown_outcome", mockReceiptConfirmed: false };
    if (record.state === "claimed") {
      const lease = await deps.browserLease();
      try {
        // A competing invocation that lost this CAS MUST NOT execute a child.
        if (!await deps.ledger.start(kick)) return;
        try {
          const result = browserResult.parse(await deps.browser(assignment.scenario));
          outcome = result.ok && result.receiptConfirmed === true && result.submissions === 1
            ? { ...outcome, outcome: "submitted", failure: null, mockReceiptConfirmed: true }
            : { ...outcome, failure: result.errorCode ?? "mock_browser_failed" };
        } catch { outcome = { ...outcome, failure: "mock_browser_failed" }; }
      } finally { await lease.release(); }
    }
    // A record left 'started' by a previous process is irreversibly unknown.
    // It may only publish a visible failure, not start Chromium a second time.
    await deps.ledger.outcome(kick, outcome);
    record = await deps.ledger.remember(kick);
  }
  if (record.state === "outcome") {
    const outcome = mockWebResultSchema.parse(record.outcome);
    acknowledgement.parse(await deps.post(MOCK_WEB_CALLBACK_PATH, outcome));
    await deps.ledger.acknowledge(kick);
  }
}
