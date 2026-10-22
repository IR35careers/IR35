import { z } from "zod";

/** Keep SDK's PUBLIC URL for generated links; only server HTTP uses private Kong.
 * Not an arbitrary proxy/SSRF fallback. Never follows a credentialed redirect.
 * Private env values are not NEXT_PUBLIC and do not enter a browser build.
 */
export function supabaseTransport(fetcher: typeof fetch = fetch): typeof fetch {
  const internal = typeof window === "undefined" ? process.env.SUPABASE_INTERNAL_URL : undefined;
  if (!internal) return fetcher;
  const target = z.url().parse(internal);
  const endpoint = new URL(target);
  if (endpoint.protocol !== "http:" || !["kong", "ir35-p5-kong"].includes(endpoint.hostname)
    || endpoint.port !== "8000" || endpoint.pathname !== "/" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    throw new Error("Invalid private Supabase endpoint; expected the isolated Kong service.");
  }
  const publicURL = new URL(z.url().parse(process.env.NEXT_PUBLIC_SUPABASE_URL));
  const prefix = publicURL.pathname.replace(/\/$/, "");
  return async (input, init) => {
    const original = new URL(input instanceof Request ? input.url : String(input));
    if (original.origin !== publicURL.origin || !original.pathname.startsWith(`${prefix}/`)) {
      throw new Error("Supabase transport refused a different origin/path; credentials withheld.");
    }
    const suffix = original.pathname.slice(prefix.length);
    if (!/^\/(?:auth|rest|storage|realtime)\/v1\//.test(suffix)) throw new Error("Supabase transport refused an unknown API path.");
    const rewritten = new URL(suffix + original.search, endpoint);
    return fetcher(input instanceof Request ? new Request(rewritten, input) : rewritten, { ...init, redirect: "error" });
  };
}
