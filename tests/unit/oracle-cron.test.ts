import { describe, expect, it, vi } from "vitest";
import { runSchedule } from "../../services/web/cron";

describe("portable internal queue cron", () => {
  it("never executes staging, disabled or maintenance schedules", async () => {
    const fetcher = vi.fn<typeof fetch>();
    for (const extra of [{ IR35_STAGING: "true" }, { IR35_SCHEDULER_ENABLED: "false" }, { IR35_READ_ONLY: "true" }]) {
      expect(await runSchedule("automation", { IR35_SCHEDULER_ENABLED: "true", ...extra }, fetcher)).toBe("disabled");
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("uses the fixed loopback queue route and shared secret header only after explicit gates", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("{}"));
    const secret = "mock-shared-cron-value-32-characters";
    expect(await runSchedule("ingest", { IR35_SCHEDULER_ENABLED: "true", APPLY_RUNNER: "oracle", CRON_SECRET: secret }, fetcher)).toBe("enqueued");
    expect(fetcher.mock.calls[0][0]).toBe("http://127.0.0.1:3000/api/pipeline/fetch");
    expect(fetcher.mock.calls[0][1]).toMatchObject({ headers: { authorization: `Bearer ${secret}` }, redirect: "error" });
    await expect(runSchedule("https://evil.test", {}, fetcher)).rejects.toThrow();
  });
  it("never reports enqueue success after an HTTP failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("private-provider-body", { status: 500 }));
    await expect(runSchedule("automation", { IR35_SCHEDULER_ENABLED: "true", APPLY_RUNNER: "oracle", CRON_SECRET: "mock-shared-cron-value-32-characters" }, fetcher)).rejects.toThrow("Internal scheduler enqueue failed");
  });
});
