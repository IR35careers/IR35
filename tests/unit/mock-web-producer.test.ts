import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockWebPublisher } from "@/lib/queue/mock-web-producer";
import { MOCK_WEB_QUEUE } from "@/lib/queue/mock-web-policy";
import { mockWebIds as ids, mockWebTestEnv } from "../helpers/mock-web-fixture";

const live = new Set<ReturnType<typeof createMockWebPublisher>>();
afterEach(async () => { await Promise.all([...live].map(value => value.close())); live.clear(); });
const env = () => ({ ...mockWebTestEnv(), PG_BOSS_DATABASE_URL: "postgres://ir35_queue_producer:fake-fixture-password@127.0.0.1:5432/postgres",
  QUEUE_DB_ALLOWED_HOSTS: "127.0.0.1" });
const kick = { kind: "staging_web_mock_delivery", applicationId: ids[1], jobId: ids[0], deliveryVersion: 3, requestedAt: "2026-10-27T10:00:00Z" };
function fixture(input = env()) {
  const boss = { on: vi.fn(), start: vi.fn(async () => undefined), send: vi.fn(async () => ids[0]), stop: vi.fn(async () => undefined) };
  const create = vi.fn(() => boss);
  const publisher = createMockWebPublisher(input, create); live.add(publisher);
  return { boss, create, publisher, input };
}
describe("single-connection isolated web mock producer", () => {
  it("awaits durable acknowledgement with an opaque version-bound singleton and zero browser retries", async () => {
    const { publisher, boss, create } = fixture();
    await publisher.publish(kick);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ max: 1, migrate: false, supervise: false,
      createSchema: false, schedule: false, registerInstance: false, ssl: false }));
    expect(boss.send).toHaveBeenCalledExactlyOnceWith(MOCK_WEB_QUEUE, kick, { singletonKey: `${kick.applicationId}:3`, retryLimit: 0 });
  });
  it("shares one startup/pool across concurrent clicks, then closes it once", async () => {
    const { publisher, boss, create } = fixture();
    await Promise.all(Array.from({ length: 20 }, () => publisher.publish(kick)));
    expect(create).toHaveBeenCalledTimes(1); expect(boss.start).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledTimes(20);
    await publisher.close(); await publisher.close(); expect(boss.stop).toHaveBeenCalledTimes(1);
  });
  it.each(["ir35_queue", "postgres", "service_role"])("refuses queue-owner/app identity %s before a client is created", async role => {
    const config = env(); config.PG_BOSS_DATABASE_URL = config.PG_BOSS_DATABASE_URL.replace("ir35_queue_producer:", `${role}:`);
    const { publisher, create } = fixture(config);
    await expect(publisher.publish(kick)).rejects.toThrow("isolated mock queue"); expect(create).not.toHaveBeenCalled();
  });
  it("refuses cloud/public TLS even when the common production validator accepts it", async () => {
    const config = env(); config.PG_BOSS_DATABASE_URL = "postgres://ir35_queue_producer:fake@aws-0-eu-west-2.pooler.supabase.com:5432/postgres";
    const { publisher, create } = fixture(config);
    await expect(publisher.publish(kick)).rejects.toThrow(); expect(create).not.toHaveBeenCalled();
  });
  it("rejects personal fields and unowned jobs without constructing a DB client", async () => {
    const { publisher, create } = fixture();
    await expect(publisher.publish({ ...kick, email: "DO-NOT-QUEUE@invalid.test" })).rejects.toThrow();
    await expect(publisher.publish({ ...kick, jobId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" })).rejects.toThrow();
    expect(create).not.toHaveBeenCalled();
  });
  it("redacts raw startup/send errors and does not confirm an unacknowledged publication", async () => {
    const { publisher, boss } = fixture();
    boss.send.mockRejectedValueOnce(new Error("fake-fixture-password"));
    await expect(publisher.publish(kick)).rejects.toThrow("No submission is confirmed");
    boss.send.mockRejectedValueOnce(new Error("fake-fixture-password"));
    try { await publisher.publish(kick); } catch (error) { expect(String(error)).not.toContain("fake-fixture-password"); }
  });
  it("rejects changing connection identity without silently reusing the cached pool", async () => {
    const { publisher, input, boss } = fixture(); await publisher.publish(kick);
    input.PG_BOSS_DATABASE_URL = input.PG_BOSS_DATABASE_URL.replace("ir35_queue_producer:", "ir35_queue:");
    await expect(publisher.publish(kick)).rejects.toThrow(); expect(boss.send).toHaveBeenCalledTimes(1);
  });
  it("revalidates cutover/provider gates on every publication, including a cached client", async () => {
    const { publisher, input, boss } = fixture(); await publisher.publish(kick);
    input.APPLICATION_WORKER_ACCEPT_JOBS = "true";
    await expect(publisher.publish(kick)).rejects.toThrow(); expect(boss.send).toHaveBeenCalledTimes(1);
  });
});
