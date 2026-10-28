/** An origin-restricted LOCAL CONNECT relay, not an internet proxy or MITM.
 * Chromium verifies the real staging certificate end-to-end through an already
 * attested SSH forward. No certificate/key, TLS interception, DNS lookup,
 * session decoding, credential capture or HTTP response fabrication occurs.
 * The controller must close the browser then this relay and its SSH forward.
 */
import { createServer } from "node:http";
import { connect, Socket } from "node:net";
import { z } from "zod";

const tunnelSchema = z.strictObject({ host: z.literal("127.0.0.1"), port: z.number().int().min(1024).max(65535), fixture: z.literal("webqa01") });
const destination = "staging.ir35careers.com:443";
export type QaProxyCounters = { accepted: number; rejected: number; failed: number; active: number };

export async function startQaProxy(input: unknown): Promise<{ server: string; counters: () => QaProxyCounters; close: () => Promise<void> }> {
  const tunnel = tunnelSchema.safeParse(input);
  if (!tunnel.success) throw new Error("AttestedLoopbackQaTunnelRequired");
  const sockets = new Set<Socket>();
  const counts: QaProxyCounters = { accepted: 0, rejected: 0, failed: 0, active: 0 };
  let closing = false;
  const server = createServer({ maxHeaderSize: 8192 }, (_request, reply) => {
    counts.rejected++; reply.writeHead(403, { connection: "close", "cache-control": "no-store" }); reply.end();
  });
  server.maxConnections = 64; server.headersTimeout = 10_000; server.requestTimeout = 15_000;
  function track(socket: Socket) {
    sockets.add(socket); socket.on("error", () => {});
    socket.once("close", () => sockets.delete(socket));
  }
  server.on("connection", socket => { track(socket); socket.setTimeout(120_000, () => socket.destroy()); });
  server.on("clientError", (_error, socket) => { counts.rejected++; socket.destroy(); });
  server.on("connect", (request, peer, head) => {
    // No IP literals, alternate ports, userinfo, suffixes, proxy credentials,
    // redirects or externally resolved names. Chromium can never reach Google,
    // cloud Supabase, the public staging edge or an employer through this relay.
    if (closing || !(peer instanceof Socket) || request.url !== destination || counts.active >= 32 || head.length > 65_536
      || request.headers["proxy-authorization"] || !["127.0.0.1", "::ffff:127.0.0.1"].includes(peer.remoteAddress ?? "")) {
      counts.rejected++; peer.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n"); return;
    }
    counts.active++;
    let established = false, failed = false, finished = false;
    const upstream = connect({ host: "127.0.0.1", port: tunnel.data.port });
    track(upstream); upstream.setTimeout(120_000, () => upstream.destroy());
    const deadline = setTimeout(() => { if (!established) abort(); }, 10_000);
    function abort() {
      if (!failed && !closing) { counts.failed++; failed = true; }
      clearTimeout(deadline); peer.destroy(); upstream.destroy();
    }
    function finish() {
      if (!finished) { finished = true; counts.active--; }
      clearTimeout(deadline); peer.destroy(); upstream.destroy();
    }
    peer.once("error", abort); upstream.once("error", abort);
    peer.once("close", finish); upstream.once("close", finish);
    upstream.once("connect", () => {
      if (closing || peer.destroyed) { finish(); return; }
      established = true; clearTimeout(deadline); counts.accepted++;
      peer.write("HTTP/1.1 200 Connection Established\r\n\r\n");
      if (head.length) upstream.write(head);
      peer.pipe(upstream); upstream.pipe(peer);
    });
  });
  await new Promise<void>((resolve, reject) => {
    const fail = () => reject(new Error("QaLocalRelayListenFailed_RawWithheld"));
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => { server.off("error", fail); resolve(); });
  });
  // Retain a safe listener: never let a raw network error dump into logs.
  server.on("error", () => { counts.failed++; });
  const address = server.address();
  if (!address || typeof address === "string") { server.close(); throw new Error("QaLocalRelayAddressRejected"); }
  return {
    server: "http://127.0.0.1:" + address.port,
    counters: () => ({ ...counts }),
    close: async () => {
      if (closing) return;
      closing = true;
      // server.close's callback can precede the sockets' asynchronous 'close'
      // notifications. Wait for BOTH actual lifetimes, not just the listener.
      const disconnected = [...sockets].map(socket => socket.closed ? Promise.resolve()
        : new Promise<void>(resolve => socket.once("close", () => resolve())));
      await new Promise<void>((resolve, reject) => {
        server.close(error => error ? reject(new Error("QaLocalRelayCloseFailed_RawWithheld")) : resolve());
        for (const socket of sockets) socket.destroy();
      });
      await Promise.all(disconnected);
      if (counts.active !== 0 || sockets.size !== 0) throw new Error("QaLocalRelayConnectionLeak");
    },
  };
}
