import { createHash } from "node:crypto";
import type { IncomingHttpHeaders } from "node:http";

/** Exact opt-in homepage only. RSC/prefetch/actions/query/personalized traffic
 * never shares HTML or security nonces. This is NOT a general CDN cache.
 */
export function cacheableHomepage(method: string, path: string, headers: IncomingHttpHeaders, enabled: boolean) {
  return enabled && method === "GET" && path === "/" && headers.accept?.includes("text/html") === true
    && !["cookie", "authorization", "rsc", "next-action", "next-router-state-tree", "next-router-prefetch", "next-url", "range", "purpose"].some(key => headers[key] !== undefined);
}

/** Hash the exact trusted server response bytes. The original nonce attributes
 * become inert: the new public-only policy contains NO nonce source. Private
 * responses retain the existing fresh nonce + strict-dynamic policy unchanged.
 * Script URL permission is narrowed to Next static chunks and the GA loader,
 * not all same-origin uploads/downloads. No unsafe-inline/eval script fallback.
 */
export function hashedPublicPolicy(html: string, policy: string, origin: string): string {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.pathname !== "/" || url.username || url.password || url.search || url.hash) throw new Error("Public CSP origin refused");
  const nonces = [...new Set(Array.from(policy.matchAll(/'nonce-([A-Za-z0-9+/=]+)'/g), match => match[1]))];
  if (nonces.length !== 1) throw new Error("One original request nonce required");
  const hashes = (tag: "script" | "style") => Array.from(html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)<\\/${tag}\\s*>`, "gi")))
    // Do not bless an injected non-nonced script that the old policy rejected.
    .filter(match => /\bnonce\s*=\s*(["'])(.*?)\1/i.exec(match[1])?.[2] === nonces[0])
    .map(match => `'sha256-${createHash("sha256").update(match[2], "utf8").digest("base64")}'`);
  if (!html.endsWith("</html>") || !html.includes("<html") || !html.includes("</body>")
    || !policy.includes("'strict-dynamic'") || !policy.includes("frame-ancestors 'none'")
    || !policy.includes("script-src-attr 'none'")) throw new Error("Complete trusted HTML/CSP required");
  const scripts = [...new Set(hashes("script"))];
  const styles = [...new Set(hashes("style"))];
  const result = policy.split(";").map(part => {
    const directive = part.trim().split(/\s+/)[0];
    if (directive === "script-src") return `script-src ${url.origin}/_next/static/ https://www.googletagmanager.com/gtag/js ${scripts.join(" ")}`;
    if (directive === "style-src-elem") return `style-src-elem 'self' ${styles.join(" ")}`;
    return part.trim();
  }).join("; ");
  if (scripts.length === 0 || Buffer.byteLength(result) > 12_000 || /'nonce-|script-src[^;]*'unsafe-/.test(result)) throw new Error("Public CSP refused; retain uncached nonce response");
  return result;
}

export class HomepageCache {
  private entry: { body: Buffer; headers: IncomingHttpHeaders; expires: number; created: number } | null = null;
  get(now = Date.now()) {
    return this.entry && now >= this.entry.created && now < this.entry.expires ? this.entry : null;
  }
  put(body: Buffer, headers: IncomingHttpHeaders, now = Date.now()) {
    if (body.length > 4_000_000 || headers["set-cookie"] || headers["content-encoding"]) return false;
    this.entry = { body, headers: { ...headers }, created: now, expires: now + 60_000 };
    return true;
  }
}
