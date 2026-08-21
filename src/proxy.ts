import { NextRequest, NextResponse } from "next/server";

const ADMIN_HOST = "admin.ir35careers.com";

export function proxy(request: NextRequest) {
  const host = request.headers.get("host")?.split(":")[0].toLowerCase();
  if (host === ADMIN_HOST && request.nextUrl.pathname === "/") {
    return NextResponse.rewrite(new URL("/admin", request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};
