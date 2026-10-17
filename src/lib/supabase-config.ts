/** Safe to import in any client or server module; contains no Supabase SDK. */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

interface SupabaseAuthSettings {
  external?: Record<string, boolean | undefined>;
}

/**
 * Checks Supabase's public auth settings before starting an OAuth redirect.
 * This prevents a disabled provider from replacing the IR35Careers interface
 * with Supabase's raw JSON validation response.
 */
export async function isSupabaseOAuthProviderEnabled(provider: string): Promise<boolean> {
  const baseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/\/+$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!baseUrl || !anonKey) return false;

  try {
    const response = await fetch(`${baseUrl}/auth/v1/settings`, {
      headers: { apikey: anonKey },
      cache: "no-store",
    });
    if (!response.ok) return false;

    const settings = (await response.json()) as SupabaseAuthSettings;
    return settings.external?.[provider.toLowerCase()] === true;
  } catch {
    return false;
  }
}
