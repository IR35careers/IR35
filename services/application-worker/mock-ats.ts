/** Loopback-only caller hosts this fixture; no credentials or employer URLs. */
import { createServer } from "node:http";

export type MockATSScenario = "success" | "server_error" | "timeout" | "lost_ack" | "captcha" | "unknown_answer";
export function mockATS(scenario: MockATSScenario) {
  let count = 0;
  const server = createServer(async (request, response) => {
    if (request.method === "GET" && request.url === "/") {
      const blocked = scenario === "captcha" ? "CAPTCHA requires a human" : scenario === "unknown_answer" ? "Unknown answer requires review" : "";
      response.writeHead(200, { "content-type": "text/html", "cache-control": "no-store" }).end(`<!doctype html><html lang="en-GB"><title>Isolated IR35 mock ATS</title><main><h1>Mock application only</h1><p>${blocked}</p><form><label>Name<input name="name" required></label><label><input name="approved" type="checkbox" required>Approved mock only</label><button>Submit mock</button></form><p role="status"></p></main><script>document.querySelector('form').addEventListener('submit',async e=>{e.preventDefault();try{const r=await fetch('/submit',{method:'POST',body:'approved-mock-only'});const receipt=await r.json();document.querySelector('[role=status]').textContent=r.ok&&receipt.receiptConfirmed===true?'Mock receipt confirmed':r.ok?'Mock outcome unknown':'Mock HTTP error';}catch{document.querySelector('[role=status]').textContent='Mock outcome unknown';}})</script></html>`); return;
    }
    if (request.method === "POST" && request.url === "/submit") {
      // Consume the accepted request before returning/truncating its response.
      // A pre-header reset can make Chromium retry a POST before the page can
      // observe it; that is NOT our intended post-acceptance lost-ack fixture.
      for await (const part of request) { void part; }
      count++;
      if (scenario === "timeout") return;
      if (scenario === "lost_ack") {
        // Valid headers, incomplete promised receipt body, graceful EOF. The
        // UI must consume/validate the receipt, never infer success from 200.
        response.writeHead(200, { "content-type": "application/json", "content-length": "128", "connection": "close" });
        response.end('{"receiptConfirmed":'); return;
      }
      const confirmed = scenario !== "server_error" && count === 1;
      response.writeHead(scenario === "server_error" ? 500 : confirmed ? 200 : 409,
        { "content-type": "application/json", "cache-control": "no-store" }).end(JSON.stringify({ receiptConfirmed: confirmed })); return;
    }
    response.writeHead(404).end();
  });
  return { server, submissions: () => count };
}
