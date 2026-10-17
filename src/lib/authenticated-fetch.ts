"use client";

import type { Session } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";

type SessionResult = {
  data: { session: Session | null };
  error: { message?: string } | null;
};

export interface SessionAuthClient {
  auth: {
    getSession: () => Promise<SessionResult>;
    refreshSession: () => Promise<SessionResult>;
  };
}

const REFRESH_WINDOW_SECONDS = 90;
const AUTH_OPERATION_TIMEOUT_MS = 12_000;

export async function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

export function sessionNeedsRefresh(session: Pick<Session, "access_token" | "expires_at"> | null, nowSeconds = Math.floor(Date.now() / 1000)): boolean {
  if (!session?.access_token) return true;
  if (!session.expires_at) return false;
  return session.expires_at <= nowSeconds + REFRESH_WINDOW_SECONDS;
}

async function refreshedAccessToken(client: SessionAuthClient): Promise<string> {
  const refreshed = await promiseWithTimeout(
    client.auth.refreshSession(),
    AUTH_OPERATION_TIMEOUT_MS,
    "Your secure session could not be refreshed. Sign in again, then retry the application.",
  );
  const token = refreshed.data.session?.access_token;
  if (refreshed.error || !token) throw new Error("Your secure session has expired. Sign in again, then retry the application.");
  return token;
}

export async function getFreshAccessToken(client: SessionAuthClient = getSupabase() as SessionAuthClient): Promise<string> {
  const current = await promiseWithTimeout(
    client.auth.getSession(),
    AUTH_OPERATION_TIMEOUT_MS,
    "Your secure session could not be checked. Sign in again, then retry the application.",
  );
  if (current.error) return refreshedAccessToken(client);
  if (sessionNeedsRefresh(current.data.session)) return refreshedAccessToken(client);
  return current.data.session?.access_token as string;
}

interface AuthenticatedFetchOptions {
  client?: SessionAuthClient;
  fetcher?: typeof fetch;
}

/**
 * Sends an authenticated request with a current access token. A 401 response
 * refreshes the session and retries the same idempotent application request
 * once, preventing a stale browser token from leaving the UI spinning.
 */
export async function fetchWithFreshSession(
  input: RequestInfo | URL,
  init: RequestInit = {},
  options: AuthenticatedFetchOptions = {},
): Promise<Response> {
  const client = options.client ?? getSupabase() as SessionAuthClient;
  const fetcher = options.fetcher ?? fetch;

  const send = async (token: string) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Bearer ${token}`);
    return fetcher(input, { ...init, headers });
  };

  let response = await send(await getFreshAccessToken(client));
  if (response.status !== 401) return response;
  response = await send(await refreshedAccessToken(client));
  return response;
}
