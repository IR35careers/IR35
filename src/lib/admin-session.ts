import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ADMIN_SESSION_TTL_SECONDS = 20 * 60;

export interface AdminSession {
  sub: string;
  email: string;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

function secret(): string {
  const value = (process.env.ADMIN_SESSION_SECRET ?? "").trim();
  if (value.length < 32) throw new Error("ADMIN_SESSION_SECRET must contain at least 32 characters.");
  return value;
}

function sign(encodedPayload: string): string {
  return createHmac("sha256", secret()).update(encodedPayload).digest("base64url");
}

export function adminSessionCookieName(): string {
  return process.env.NODE_ENV === "production" ? "__Host-ir35_admin" : "ir35_admin_dev";
}

export function createAdminSession(user: { id: string; email: string }, now = Date.now()): string {
  const payload: AdminSession = {
    sub: user.id,
    email: user.email.trim().toLowerCase(),
    issuedAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_SECONDS * 1000,
    nonce: randomBytes(16).toString("base64url"),
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded)}`;
}

export function verifyAdminSession(token?: string | null, now = Date.now()): AdminSession | null {
  if (!token) return null;
  try {
    const [encoded, signature, extra] = token.split(".");
    if (!encoded || !signature || extra) return null;
    const expected = Buffer.from(sign(encoded));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<AdminSession>;
    if (
      typeof payload.sub !== "string" ||
      typeof payload.email !== "string" ||
      typeof payload.issuedAt !== "number" ||
      typeof payload.expiresAt !== "number" ||
      typeof payload.nonce !== "string" ||
      payload.expiresAt <= now ||
      payload.issuedAt > now + 60_000 ||
      payload.expiresAt - payload.issuedAt > ADMIN_SESSION_TTL_SECONDS * 1000
    ) return null;
    return payload as AdminSession;
  } catch {
    return null;
  }
}

export function adminSessionCookieOptions(maxAge = ADMIN_SESSION_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict" as const,
    path: "/",
    maxAge,
  };
}

export function adminAllowlist(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminRequestHost(request: Request): boolean {
  try {
    const hostHeader = request.headers.get("host")?.trim().toLowerCase();
    const hostname = (hostHeader
      ? hostHeader.startsWith("[")
        ? hostHeader.slice(1, hostHeader.indexOf("]"))
        : hostHeader.split(":", 1)[0]
      : new URL(request.url).hostname
    ).toLowerCase();
    return hostname === "admin.ir35careers.com"
      || (process.env.NODE_ENV !== "production" && (hostname === "localhost" || hostname === "127.0.0.1"));
  } catch {
    return false;
  }
}

export function cookieValue(request: Request, name: string): string | null {
  const cookie = request.headers.get("cookie") ?? "";
  for (const item of cookie.split(";")) {
    const [rawName, ...rawValue] = item.trim().split("=");
    if (rawName === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}
