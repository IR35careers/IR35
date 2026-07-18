/**
 * Server-only Supabase client using the SECRET key.
 *
 * ⚠️ This bypasses Row Level Security. It must only ever be imported from
 * server-side code (API routes, server components) — NEVER from anything
 * that ships to the browser. That's also why the env var is named
 * SUPABASE_SECRET_KEY with no NEXT_PUBLIC_ prefix: Next.js physically
 * excludes non-NEXT_PUBLIC vars from client bundles.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getSupabaseAdmin(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SECRET_KEY environment variable. " +
        "Add SUPABASE_SECRET_KEY (the sb_secret_... key from Supabase → Settings → API Keys) " +
        "to .env.local and to Vercel → Project → Settings → Environment Variables."
    );
  }

  cached = createClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
