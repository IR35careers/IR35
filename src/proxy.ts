import { NextRequest, NextResponse } from "next/server";

const ADMIN_HOST = "admin.ir35careers.com";
const PUBLIC_HOSTS = new Set(["ir35careers.com", "www.ir35careers.com"]);

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  const pathname = request.nextUrl.pathname;

  if (host === ADMIN_HOST) {
    if (pathname.startsWith("/api/") || pathname.startsWith("/_next/") || /\.[a-z0-9]+$/i.test(pathname)) {
      return NextResponse.next();
    }
    if (pathname === "/") return NextResponse.rewrite(new URL("/admin", request.url));
    if (pathname === "/login") return NextResponse.rewrite(new URL("/admin/login", request.url));
    if (pathname === "/admin") return NextResponse.redirect(new URL("/", request.url));
    if (pathname === "/admin/login") return NextResponse.redirect(new URL("/login", request.url));
    return NextResponse.redirect(new URL("/", request.url));
  }

  if (host && PUBLIC_HOSTS.has(host)) {
    if (pathname === "/admin") return NextResponse.redirect(`https://${ADMIN_HOST}/`);
    if (pathname === "/admin/login") return NextResponse.redirect(`https://${ADMIN_HOST}/login`);
    if (pathname === "/jobs/sources") return NextResponse.redirect(new URL("/jobs", request.url), 308);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
