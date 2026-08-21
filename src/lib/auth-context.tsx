"use client";

/**
 * Shared Supabase auth state without a root-level client boundary.
 *
 * Public server-rendered pages stay outside React hydration. Components that
 * call useAuth subscribe to this small external store, and the Supabase SDK is
 * loaded only when a session/callback exists or an account action is used.
 */

import { useEffect, useSyncExternalStore } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { resolvePostAuthPath } from "@/lib/auth-routing";
import { isAdministratorEmail } from "@/lib/portal-access";

interface AuthResult {
  error: string | null;
  /** True when sign-up created an account that needs email confirmation. */
  needsConfirmation?: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signUpWithPassword: (email: string, password: string, next?: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  signInWithGoogle: (next?: string) => Promise<AuthResult>;
  signInWithGoogleAdmin: () => Promise<AuthResult>;
  signInWithGoogleIdToken: (token: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

interface AuthState {
  user: User | null;
  loading: boolean;
}

let state: AuthState = { user: null, loading: isSupabaseConfigured() };
const serverState: AuthState = { user: null, loading: isSupabaseConfigured() };
const listeners = new Set<() => void>();
let sessionInitialising = false;
let sessionSubscribed = false;
let storageSubscribed = false;
const welcomeRequestedFor = new Set<string>();

function publish(next: AuthState) {
  if (state.user === next.user && state.loading === next.loading) return;
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot() {
  return state;
}

function getServerSnapshot() {
  return serverState;
}

function isSessionKey(key: string | null): boolean {
  return Boolean(key?.startsWith("sb-") && key.endsWith("-auth-token"));
}

function hasStoredSession(): boolean {
  try {
    return Object.keys(window.localStorage).some((key) => isSessionKey(key));
  } catch {
    return false;
  }
}

function hasAuthCallback(): boolean {
  const query = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
  return query.has("code") || query.has("error") || hash.has("access_token") || hash.has("refresh_token") || hash.has("error");
}

function installStorageListener() {
  if (storageSubscribed) return;
  storageSubscribed = true;
  window.addEventListener("storage", (event) => {
    if (!isSessionKey(event.key)) return;
    if (event.newValue) {
      publish({ ...state, loading: true });
      initialiseSession(true);
    } else {
      publish({ user: null, loading: false });
    }
  });
}

function requestWelcomeEmail(session: Session | null) {
  if (!session?.user?.id || !session.access_token || isAdministratorEmail(session.user.email) || welcomeRequestedFor.has(session.user.id)) return;
  welcomeRequestedFor.add(session.user.id);
  void fetch("/api/email/welcome", {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}` },
    keepalive: true,
  }).then((response) => {
    if (response.status >= 500) welcomeRequestedFor.delete(session.user.id);
  }).catch(() => welcomeRequestedFor.delete(session.user.id));
}

function initialiseSession(force = false) {
  if (!isSupabaseConfigured()) {
    publish({ user: null, loading: false });
    return;
  }
  installStorageListener();
  if (!force && !hasStoredSession() && !hasAuthCallback()) {
    publish({ user: null, loading: false });
    return;
  }
  if (sessionInitialising || sessionSubscribed) return;
  sessionInitialising = true;

  void import("@/lib/supabase")
    .then(({ getSupabase }) => {
      const supabase = getSupabase();
      void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
        publish({ user: data.session?.user ?? null, loading: false });
        requestWelcomeEmail(data.session);
      });
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (_event: string, session: Session | null) => {
          publish({ user: session?.user ?? null, loading: false });
          requestWelcomeEmail(session);
        }
      );
      sessionSubscribed = true;
      sessionInitialising = false;
      // Keep the listener for the lifetime of this browser document.
      void subscription;
    })
    .catch(() => {
      sessionInitialising = false;
      publish({ user: null, loading: false });
    });
}

async function signInWithPassword(email: string, password: string): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  const { getSupabase } = await import("@/lib/supabase");
  const { data, error } = await getSupabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
  if (!error) {
    publish({ user: data.user, loading: false });
    initialiseSession(true);
  }
  return { error: error ? error.message : null };
}

async function signUpWithPassword(email: string, password: string, next = "/dashboard"): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  const { getSupabase } = await import("@/lib/supabase");
  const { data, error } = await getSupabase().auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    options: {
      emailRedirectTo: `${window.location.origin}${resolvePostAuthPath(next)}`,
      data: {
        terms_accepted_at: new Date().toISOString(),
        terms_version: "2026-08-20",
        privacy_notice_version: "2026-08-20",
        welcome_email_eligible_at: new Date().toISOString(),
      },
    },
  });
  if (error) return { error: error.message };
  if (data.session?.user) {
    publish({ user: data.session.user, loading: false });
    initialiseSession(true);
  }
  return { error: null, needsConfirmation: Boolean(data.user && !data.session) };
}

async function signInWithGoogle(next = "/dashboard"): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  const { getSupabase } = await import("@/lib/supabase");
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: `${window.location.origin}${resolvePostAuthPath(next)}` },
  });
  return { error: error ? error.message : null };
}

async function signInWithGoogleAdmin(): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  const { getSupabase } = await import("@/lib/supabase");
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/`,
      queryParams: { prompt: "select_account" },
    },
  });
  return { error: error ? error.message : null };
}

async function signInWithGoogleIdToken(token: string): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  if (!token.trim()) return { error: "Google did not return a secure identity token." };
  const { getSupabase } = await import("@/lib/supabase");
  const { data, error } = await getSupabase().auth.signInWithIdToken({ provider: "google", token });
  if (!error) {
    publish({ user: data.user, loading: false });
    requestWelcomeEmail(data.session);
    initialiseSession(true);
  }
  return { error: error ? error.message : null };
}

async function requestPasswordReset(email: string): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  const { getSupabase } = await import("@/lib/supabase");
  const { error } = await getSupabase().auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: `${window.location.origin}/account/reset`,
  });
  return { error: error ? error.message : null };
}

async function updatePassword(newPassword: string): Promise<AuthResult> {
  if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
  const { getSupabase } = await import("@/lib/supabase");
  const { data, error } = await getSupabase().auth.updateUser({ password: newPassword });
  if (!error && data.user) publish({ user: data.user, loading: false });
  return { error: error ? error.message : null };
}

async function signOut(): Promise<void> {
  if (isSupabaseConfigured()) {
    const { getSupabase } = await import("@/lib/supabase");
    await getSupabase().auth.signOut();
  }
  publish({ user: null, loading: false });
}

export function useAuth(): AuthContextValue {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  useEffect(() => initialiseSession(), []);
  return {
    ...snapshot,
    signInWithPassword,
    signUpWithPassword,
    requestPasswordReset,
    signInWithGoogle,
    signInWithGoogleAdmin,
    signInWithGoogleIdToken,
    updatePassword,
    signOut,
  };
}
