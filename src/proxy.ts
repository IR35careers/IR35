import { NextRequest, NextResponse } from "next/server";

const ADMIN_HOST = "admin.ir35careers.com";
const PUBLIC_HOSTS = new Set(["ir35careers.com", "www.ir35careers.com"]);

function requestNonce(): string {
  return btoa(crypto.randomUUID());
}

function configuredSupabaseConnectSources(): string[] {
  const configured = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!configured) return [];

  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || url.username || url.password) return [];
    return [url.origin, `wss://${url.host}`];
  } catch {
    return [];
  }
}

function contentSecurityPolicy(nonce: string): string {
  const connectSources = ["'self'", ...configuredSupabaseConnectSources()].join(" ");
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    "script-src-attr 'none'",
    "style-src 'self'",
    `style-src-elem 'self' 'nonce-${nonce}'`,
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src ${connectSources}`,
    "media-src 'self' blob:",
    "worker-src 'self' blob:",
    "frame-src 'self'",
    "manifest-src 'self'",
    "upgrade-insecure-requests",
  ].join("; ");
}

export function proxy(request: NextRequest) {
  const nonce = requestNonce();
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set("x-nonce", nonce);
  const protect = (response: NextResponse) => {
    response.headers.set("Content-Security-Policy", contentSecurityPolicy(nonce));
    if (request.nextUrl.pathname === "/api/admin" || request.nextUrl.pathname.startsWith("/api/admin/")) {
      response.headers.set("Cache-Control", "no-store, private");
      response.headers.set("Pragma", "no-cache");
    }
    return response;
  };
  const next = () => protect(NextResponse.next({ request: { headers: forwardedHeaders } }));
  const rewrite = (url: URL) => protect(NextResponse.rewrite(url, { request: { headers: forwardedHeaders } }));
  const redirect = (url: URL | string, status?: 301 | 302 | 303 | 307 | 308) => protect(NextResponse.redirect(url, status));
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;

  if (host === ADMIN_HOST) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(pathname)) {
      return next();
    }
    if (pathname === "/") return rewrite(new URL("/admin", request.url));
    if (pathname === "/login") return rewrite(new URL("/admin/login", request.url));
    if (pathname === "/admin") return redirect(new URL("/", request.url));
    if (pathname === "/admin/login") return redirect(new URL("/login", request.url));
    return redirect(new URL("/", request.url));
  }

  if (host && PUBLIC_HOSTS.has(host)) {
    if (pathname === "/api/admin" || pathname.startsWith("/api/admin/")) {
      return protect(new NextResponse("Not found", { status: 404 }));
    }
    if (pathname === "/admin") return redirect(`https://${ADMIN_HOST}/`);
    if (pathname === "/admin/login") return redirect(`https://${ADMIN_HOST}/login`);
    if (pathname === "/jobs/sources") return redirect(new URL("/jobs", request.url), 308);
  }
  return next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
