import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWebMockWorker } from "../../services/application-worker/mock-web-runtime";
import { mockWebTestEnv } from "../helpers/mock-web-fixture";

const fixture = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn(), sql: vi.fn(), fetch: vi.fn(),
  browser: vi.fn(), lease: vi.fn(), release: vi.fn(), post: vi.fn(), construct: vi.fn(), createServer: vi.fn() }));
vi.mock("node:http", async original => ({ ...await original<typeof import("node:http")>(), createServer: fixture.createServer }));
vi.mock("pg-boss", () => ({ PgBoss: class {
  constructor(options: unknown) { fixture.construct(options); }
  on() {} start = fixture.start; stop = fixture.stop; fetch = fixture.fetch;
  getDb() { return { executeSql: fixture.sql }; }
} }));
vi.mock("../../services/application-worker/mock-runtime", async original => ({
  ...await original<typeof import("../../services/application-worker/mock-runtime")>(), runMockBrowser: fixture.browser,
}));
vi.mock("../../services/application-worker/mock-store", async original => ({
  ...await original<typeof import("../../services/application-worker/mock-store")>(),
  MockStore: class { browserLease = fixture.lease; },
}));
vi.mock("@/lib/queue/mock-web-http", async original => ({
  ...await original<typeof import("@/lib/queue/mock-web-http")>(), mockWebInternalPost: fixture.post,
}));
beforeEach(() => {
  vi.clearAllMocks(); fixture.start.mockResolvedValue(undefined); fixture.stop.mockResolvedValue(undefined);
  fixture.sql.mockResolvedValue({ rows: [] }); fixture.browser.mockResolvedValue({ ok: true, browserReady: true, submissions: 0 });
  fixture.release.mockResolvedValue(undefined); fixture.lease.mockResolvedValue({ release: fixture.release });
  fixture.post.mockResolvedValue({ ok: true, timedOut: 0 });
  const server = new EventEmitter();
  Object.assign(server, { listen: () => { queueMicrotask(() => server.emit("error", new Error("fixture-listener-unavailable"))); } });
  fixture.createServer.mockReturnValue(server);
});
const env = () => ({ ...mockWebTestEnv(), PG_BOSS_DATABASE_URL: "postgres://ir35_queue:fake@127.0.0.1:5432/postgres",
  QUEUE_DB_ALLOWED_HOSTS: "127.0.0.1", IR35_BUILD_SHA: "a".repeat(40) });
function closedWithoutConsumption() {
  expect(fixture.stop).toHaveBeenCalledExactlyOnceWith({ graceful: false });
  expect(fixture.fetch).not.toHaveBeenCalled();
  expect(fixture.construct).toHaveBeenCalledWith(expect.objectContaining({ max: 2, supervise: false, registerInstance: false, migrate: false }));
}
describe("mock-only worker fail-closed startup (no DB/browser/operator state)", () => {
  it("closes even a partially started pool without activating a consumer", async () => {
    fixture.start.mockRejectedValue(new Error("fixture-start-failure-no-secret"));
    await expect(runWebMockWorker(env())).rejects.toThrow("no consumer was activated");
    closedWithoutConsumption(); expect(fixture.browser).not.toHaveBeenCalled();
  });
  it("releases exclusion and closes the pool when Chromium readiness fails", async () => {
    fixture.browser.mockRejectedValue(new Error("fixture-browser-unavailable"));
    await expect(runWebMockWorker(env())).rejects.toThrow("no consumer was activated");
    closedWithoutConsumption(); expect(fixture.release).toHaveBeenCalledTimes(1); expect(fixture.post).not.toHaveBeenCalled();
  });
  it("does not consume when the durable ledger preflight fails", async () => {
    fixture.sql.mockRejectedValue(new Error("fixture-ledger-missing"));
    await expect(runWebMockWorker(env())).rejects.toThrow("no consumer was activated");
    closedWithoutConsumption(); expect(fixture.post).not.toHaveBeenCalled();
  });
  it("closes the pool if the private app control gate fails", async () => {
    fixture.post.mockRejectedValue(new Error("fixture-control-unavailable"));
    await expect(runWebMockWorker(env())).rejects.toThrow("no consumer was activated");
    closedWithoutConsumption(); expect(fixture.release).toHaveBeenCalledTimes(1);
  });
  it("creates no polling timers or queue fetch if binding health fails", async () => {
    await expect(runWebMockWorker(env())).rejects.toThrow("no consumer was activated");
    expect(fixture.createServer).toHaveBeenCalledTimes(1);
    closedWithoutConsumption(); expect(fixture.post).toHaveBeenCalledTimes(1);
  });
});
