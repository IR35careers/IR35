import https from "node:https";
import { isIP } from "node:net";
import { resolvePublicHttpsUrl } from "@/lib/security/public-url";

export interface PinnedHttpsResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}

export async function getPinnedPublicHttps(
  value: string,
  options: { maxBytes: number; timeoutMs: number; headers?: Record<string, string> },
): Promise<PinnedHttpsResponse> {
  const resolved = await resolvePublicHttpsUrl(value);
  const tlsHost = resolved.url.hostname.replace(/^\[|\]$/g, "");
  let lastError: unknown;

  for (const approvedAddress of resolved.addresses) {
    try {
      return await new Promise<PinnedHttpsResponse>((resolve, reject) => {
        const request = https.request(resolved.url, {
          method: "GET",
          headers: options.headers,
          ...(isIP(tlsHost) ? {} : { servername: tlsHost }),
          lookup: (_hostname, _lookupOptions, callback) => {
            callback(null, approvedAddress.address, approvedAddress.family);
          },
        }, (response) => {
          const status = response.statusCode ?? 0;
          if (status >= 300 && status < 400) {
            response.resume();
            resolve({ status, headers: response.headers, body: Buffer.alloc(0) });
            return;
          }

          const declared = Number(response.headers["content-length"] ?? "0");
          if (Number.isFinite(declared) && declared > options.maxBytes) {
            response.destroy();
            reject(new Error("The source page is too large to analyse safely."));
            return;
          }
          const chunks: Buffer[] = [];
          let total = 0;
          response.on("data", (chunk: Buffer) => {
            total += chunk.byteLength;
            if (total > options.maxBytes) {
              response.destroy(new Error("The source page is too large to analyse safely."));
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => resolve({ status, headers: response.headers, body: Buffer.concat(chunks, total) }));
          response.on("error", reject);
        });
        request.setTimeout(options.timeoutMs, () => request.destroy(new Error("The source took too long to respond.")));
        request.on("error", reject);
        request.end();
      });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("The source page could not be loaded.");
}
