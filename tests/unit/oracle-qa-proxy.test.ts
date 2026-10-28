import { createServer, connect, type Server, type Socket } from "node:net";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { startQaProxy } from "../../scripts/oracle-qa-proxy";
import { qaBrowserHeaders, QA_ORIGIN } from "../../scripts/oracle-qa-transport";

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function backend() {
  const peers = new Set<Socket>();
  const server = createServer(socket => { peers.add(socket); socket.on("close", () => peers.delete(socket)); socket.pipe(socket); });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  cleanup.push(async () => { for (const socket of peers) socket.destroy(); await new Promise<void>(resolve => server.close(() => resolve())); });
  return { server, port: (server.address() as { port: number }).port };
}
async function client(proxy: { server: string }, request: string) {
  const socket = connect({ host: "127.0.0.1", port: Number(new URL(proxy.server).port) });
  cleanup.push(async () => { if (!socket.destroyed) { socket.destroy(); await once(socket, "close"); } });
  await once(socket, "connect");
  const next = once(socket, "data"); socket.write(request);
  const [body] = await next as [Buffer];
  return { socket, body: body.toString() };
}
async function relay(port: number) {
  const value = await startQaProxy({ host: "127.0.0.1", port, fixture: "webqa01" });
  cleanup.push(value.close); return value;
}

describe("local browser CONNECT relay to the owned QA fixture", () => {
  it("passes the actual byte stream only to the attested SSH tunnel, including WebSocket traffic, without decoding it", async () => {
    const target = await backend(), proxy = await relay(target.port);
    expect((target.server as Server).listening).toBe(true);
    const peer = await client(proxy, "CONNECT staging.ir35careers.com:443 HTTP/1.1\r\nHost: staging.ir35careers.com:443\r\n\r\n");
    expect(peer.body).toBe("HTTP/1.1 200 Connection Established\r\n\r\n");
    const next = once(peer.socket, "data");
    const bytes = Buffer.from([22, 3, 3, 0, 4, 0, 128, 255, 1]); // synthetic opaque bytes; never a real session.
    peer.socket.write(bytes);
    expect((await next)[0]).toEqual(bytes);
    expect(proxy.counters()).toEqual({ accepted: 1, rejected: 0, failed: 0, active: 1 });
    await proxy.close();
    expect(proxy.counters().active).toBe(0);
  });
  it.each(["www.ir35careers.com:443", "api-staging.ir35careers.com:443", "staging.ir35careers.com.evil.invalid:443",
    "staging.ir35careers.com:80", "127.0.0.1:443", "169.254.169.254:80", "employer.invalid:443"])("rejects an unapproved CONNECT target %s before upstream activity", async authority => {
    const target = await backend(), proxy = await relay(target.port);
    const peer = await client(proxy, "CONNECT " + authority + " HTTP/1.1\r\nHost: " + authority + "\r\n\r\n");
    expect(peer.body).toContain("403 Forbidden"); expect(proxy.counters()).toEqual({ accepted: 0, rejected: 1, failed: 0, active: 0 });
  });
  it("rejects normal HTTP and supplied proxy credentials instead of forwarding them", async () => {
    const target = await backend(), proxy = await relay(target.port);
    expect((await client(proxy, "GET http://employer.invalid/ HTTP/1.1\r\nHost: employer.invalid\r\n\r\n")).body).toContain("403 Forbidden");
    expect((await client(proxy, "CONNECT staging.ir35careers.com:443 HTTP/1.1\r\nHost: staging.ir35careers.com:443\r\nProxy-Authorization: Basic not-real\r\n\r\n")).body).toContain("403 Forbidden");
    expect(proxy.counters()).toEqual({ accepted: 0, rejected: 2, failed: 0, active: 0 });
  });
  it("does not start listening for an arbitrary tunnel or unknown fixture", async () => {
    for (const value of [{ host: "132.145.28.134", port: 443, fixture: "webqa01" },
      { host: "127.0.0.1", port: 5432, fixture: "original" }, { host: "127.0.0.1", port: 443, fixture: "webqa01", extra: true }]) {
      await expect(startQaProxy(value)).rejects.toThrow("AttestedLoopbackQaTunnelRequired");
    }
  });
  it("route.continue headers keep real app Bearer and SDK cookie auth while isolating edge Basic", () => {
    const credential = { username: "ir35", password: "a".repeat(48) };
    const app = qaBrowserHeaders(QA_ORIGIN + "/api/applications/submit", "POST", { authorization: "Bearer fake-session" }, credential);
    expect(app.authorization).toBe("Bearer fake-session"); expect(app["x-staging-authorization"]).toMatch(/^Basic /);
    const sdk = qaBrowserHeaders(QA_ORIGIN + "/supabase/rest/v1/saved_jobs", "POST", {
      authorization: "Bearer fake-session", cookie: "__Host-ir35-staging=fake-gate",
    }, credential);
    expect(sdk.authorization).toBe("Bearer fake-session"); expect(sdk.cookie).toBe("__Host-ir35-staging=fake-gate");
    expect(sdk["x-staging-authorization"]).toBeUndefined();
    expect(() => qaBrowserHeaders("https://employer.invalid/", "GET", {}, credential)).toThrow("BoundaryRejected");
  });
});
