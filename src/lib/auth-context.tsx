"use client";

/**
 * Auth context — tracks the current Supabase user across the app.
 *
 * Wraps the app in layout.tsx. Any client component can call useAuth() to read
 * { user, loading } and the sign-in / sign-up / sign-out actions. Sessions are
 * persisted by supabase-js in the browser, so a refresh keeps you logged in.
 */

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { isSupabaseConfigured } from "@/lib/supabase-config";

interface AuthResult {
  error: string | null;
  /** True when sign-up created an account that needs email confirmation. */
  needsConfirmation?: boolean;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<AuthResult>;
  signUpWithPassword: (email: string, password: string) => Promise<AuthResult>;
  requestPasswordReset: (email: string) => Promise<AuthResult>;
  signInWithGoogle: (next?: string) => Promise<AuthResult>;
  updatePassword: (newPassword: string) => Promise<AuthResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isSupabaseConfigured());

  useEffect(() => {
    let mounted = true;
    let unsubscribe: (() => void) | undefined;
    let initialized = false;

    if (!isSupabaseConfigured()) {
      return () => {
        mounted = false;
      };
    }

    const initialiseSession = () => {
      if (initialized) return;
      initialized = true;
      void import("@/lib/supabase").then(({ getSupabase }) => {
        if (!mounted) return;
        const supabase = getSupabase();
        void supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => {
          if (!mounted) return;
          setUser(data.session?.user ?? null);
          setLoading(false);
        });

        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          (_event: string, session: Session | null) => {
            if (!mounted) return;
            setUser(session?.user ?? null);
            setLoading(false);
          }
        );
        unsubscribe = () => subscription.unsubscribe();
      });
    };

    const isSessionKey = (key: string | null) => Boolean(key?.startsWith("sb-") && key.endsWith("-auth-token"));
    let hasStoredSession = false;
    try {
      hasStoredSession = Object.keys(window.localStorage).some((key) => isSessionKey(key));
    } catch {
      // Storage may be disabled; account actions can still report their provider result.
    }
    if (hasStoredSession) initialiseSession();
    else setLoading(false);

    const handleStorage = (event: StorageEvent) => {
      if (!isSessionKey(event.key)) return;
      if (event.newValue) {
        setLoading(true);
        initialiseSession();
      } else {
        setUser(null);
        setLoading(false);
      }
    };
    window.addEventListener("storage", handleStorage);

    return () => {
      mounted = false;
      unsubscribe?.();
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const signInWithPassword = async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (!error) {
      setUser(data.user);
      setLoading(false);
    }
    return { error: error ? error.message : null };
  };

  const signUpWithPassword = async (email: string, password: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.signUp({
      email: email.trim().toLowerCase(),
      password,
      options: {
        data: {
          terms_accepted_at: new Date().toISOString(),
          terms_version: "2026-08-20",
          privacy_notice_version: "2026-08-20",
        },
      },
    });
    if (error) return { error: error.message };
    if (data.session?.user) {
      setUser(data.session.user);
      setLoading(false);
    }
    // If email confirmation is ON, there's a user but no active session yet.
    const needsConfirmation = !!data.user && !data.session;
    return { error: null, needsConfirmation };
  };

  const signInWithGoogle = async (next = "/dashboard"): Promise<AuthResult> => {
    if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}${next}` },
    });
    return { error: error ? error.message : null };
  };

  const requestPasswordReset = async (email: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
      redirectTo: `${window.location.origin}/account/reset`,
    });
    return { error: error ? error.message : null };
  };

  const updatePassword = async (newPassword: string): Promise<AuthResult> => {
    if (!isSupabaseConfigured()) return { error: "Account services are unavailable in this local preview." };
    const { getSupabase } = await import("@/lib/supabase");
    const supabase = getSupabase();
    const { data, error } = await supabase.auth.updateUser({ password: newPassword });
    if (!error && data.user) setUser(data.user);
    return { error: error ? error.message : null };
  };

  const signOut = async (): Promise<void> => {
    if (isSupabaseConfigured()) {
      const { getSupabase } = await import("@/lib/supabase");
      await getSupabase().auth.signOut();
    }
    setUser(null);
  };

  return (
    <AuthContext.Provider
      value={{ user, loading, signInWithPassword, signUpWithPassword, requestPasswordReset, signInWithGoogle, updatePassword, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within <AuthProvider>");
  return ctx;
}
