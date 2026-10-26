import { once } from "node:events";
import type { AddressInfo } from "node:net";
import { expect, test } from "vitest";
import { mockATS, type MockATSScenario } from "../../services/application-worker/mock-ats";

async function fixture(scenario: MockATSScenario, action: (url: string, count: () => number) => Promise<void>) {
  const { server, submissions } = mockATS(scenario);
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try { await action(`http://127.0.0.1:${(server.address() as AddressInfo).port}`, submissions); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

test("mock success has an explicit receipt and duplicate submissions are rejected", async () => {
  await fixture("success", async (url, count) => {
    const first = await fetch(url + "/submit", { method: "POST", body: "approved-mock-only" });
    expect(first.status).toBe(200); expect(await first.json()).toEqual({ receiptConfirmed: true });
    const second = await fetch(url + "/submit", { method: "POST", body: "approved-mock-only" });
    expect(second.status).toBe(409); expect(await second.json()).toEqual({ receiptConfirmed: false });
    expect(count()).toBe(2);
  });
});

test("lost ack is a truncated post-acceptance body, not a pre-header reset", async () => {
  await fixture("lost_ack", async (url, count) => {
    const reply = await fetch(url + "/submit", { method: "POST", body: "approved-mock-only" });
    expect(reply.status).toBe(200);
    expect(reply.headers.get("content-length")).toBe("128");
    await expect(reply.json()).rejects.toThrow();
    expect(count()).toBe(1);
  });
});

test("mock page consumes the receipt before asserting success; server error never confirms", async () => {
  await fixture("server_error", async (url, count) => {
    const html = await (await fetch(url)).text();
    expect(html).toContain("await r.json()");
    expect(html).toContain("receipt.receiptConfirmed===true");
    expect(count()).toBe(0);
    const reply = await fetch(url + "/submit", { method: "POST", body: "approved-mock-only" });
    expect(reply.status).toBe(500); expect(await reply.json()).toEqual({ receiptConfirmed: false });
    expect(count()).toBe(1);
  });
});
