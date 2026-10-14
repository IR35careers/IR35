import { describe, expect, it, vi } from "vitest";
import { clickAndFollow } from "@/lib/application-runner/run";
import { ApplicationRunnerPreSubmitError, runnerInterruptionAction } from "@/lib/application-runner/failure";
import { shouldAutomaticallyRetryWorkerAttention } from "@/lib/application-worker-retry";
import { buildApplicationAttention } from "@/lib/application-attention";
import type { Locator, Page } from "playwright-core";

describe("submission boundary protection", () => {
  it("retries only interruptions known to precede the final action", () => {
    expect(new ApplicationRunnerPreSubmitError(new Error("browser launch failed")).name).toBe("ApplicationRunnerPreSubmitError");
    expect(runnerInterruptionAction(false)).toBe("runner_timeout");
    expect(shouldAutomaticallyRetryWorkerAttention({ action: runnerInterruptionAction(false), attempts: 1 })).toBe(true);
    expect(runnerInterruptionAction(true)).toBe("confirmation_pending");
    expect(shouldAutomaticallyRetryWorkerAttention({ action: runnerInterruptionAction(true), attempts: 1 })).toBe(false);
    expect(buildApplicationAttention({ action: "confirmation_pending" }).kind).toBe("confirmation_pending");
  });
  it("never force-clicks a final submit button again after an ambiguous click failure", async () => {
    const action = { click: vi.fn().mockRejectedValue(new Error("navigation disconnected")), isVisible: vi.fn().mockResolvedValue(true), isEnabled: vi.fn().mockResolvedValue(true) };
    const page = { waitForEvent: vi.fn().mockResolvedValue(null) };
    await expect(clickAndFollow(page as unknown as Page, action as unknown as Locator, 0, false)).rejects.toThrow("navigation disconnected");
    expect(action.click).toHaveBeenCalledOnce();
  });
  it("does not auto-retry required unanswered questions", () => {
    expect(shouldAutomaticallyRetryWorkerAttention({ action: "browser_continue", attempts: 1, hasUnansweredQuestions: true })).toBe(false);
  });
});
