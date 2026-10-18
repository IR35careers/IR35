import { z } from "zod";

export const googleClientIdSchema = z.string().regex(/^\d+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com$/).max(250);
export const googleIdTokenInputSchema = z.object({
  token: z.string().min(80).max(16_384).regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/),
  nonce: z.string().length(43).regex(/^[A-Za-z0-9_-]+$/),
});
const credentialSchema = z.object({ credential: googleIdTokenInputSchema.shape.token });
const claimsSchema = z.object({
  nonce: z.string().regex(/^[0-9a-f]{64}$/),
  aud: googleClientIdSchema,
  iss: z.enum(["accounts.google.com", "https://accounts.google.com"]),
  exp: z.number().int().positive(),
});

export function googleRedirectFallbackEnabled(): boolean {
  return process.env.NEXT_PUBLIC_GOOGLE_REDIRECT_FALLBACK_ENABLED === "true";
}

export function configuredGoogleClientId(): string | null {
  const value = googleClientIdSchema.safeParse(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID?.trim());
  return value.success ? value.data : null;
}

export async function generateGoogleNonce(cryptoApi: Crypto = crypto): Promise<{ raw: string; hashed: string }> {
  const raw = btoa(String.fromCharCode(...cryptoApi.getRandomValues(new Uint8Array(32))))
    .replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
  const digest = new Uint8Array(await cryptoApi.subtle.digest("SHA-256", new TextEncoder().encode(raw)));
  return { raw, hashed: Array.from(digest, value => value.toString(16).padStart(2, "0")).join("") };
}

/** Shape/intent check only. Supabase still verifies Google's signature and claims. */
export function googleCredentialMatches(response: unknown, hashedNonce: string, clientId: string, now = Date.now()): string | null {
  const parsed = credentialSchema.safeParse(response);
  if (!parsed.success) return null;
  try {
    const encoded = parsed.data.credential.split(".")[1].replaceAll("-", "+").replaceAll("_", "/");
    const bytes = Uint8Array.from(atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "=")), char => char.charCodeAt(0));
    const claims = claimsSchema.safeParse(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (!claims.success || claims.data.nonce !== hashedNonce || claims.data.aud !== clientId || claims.data.exp * 1000 <= now) return null;
    return parsed.data.credential;
  } catch { return null; }
}

/** Raw nonce stays in this short-lived closure, never storage, URL or logs. */
export async function createGoogleIdentityAttempt(clientId: string, now: () => number = Date.now) {
  googleClientIdSchema.parse(clientId);
  const pair = await generateGoogleNonce();
  const hashedNonce = pair.hashed;
  let raw = pair.raw;
  const expiresAt = now() + 5 * 60_000;
  let consumed = false;
  return {
    hashedNonce,
    discard() { consumed = true; raw = ""; },
    async exchange<T>(response: unknown, exchange: (token: string, nonce: string) => Promise<T>): Promise<T> {
      if (consumed || now() >= expiresAt) throw new Error("Google sign-in expired. Choose Try Google again.");
      consumed = true;
      const nonce = raw; raw = "";
      const token = googleCredentialMatches(response, hashedNonce, clientId, now());
      if (!token) throw new Error("Google returned an invalid or mismatched sign-in. Choose Try Google again.");
      return exchange(token, nonce);
    },
  };
}

export interface GoogleIdentityApi {
  initialize: (options: { client_id: string; nonce: string; callback: (response: unknown) => void; auto_select: false; button_auto_select: false; use_fedcm_for_button: true; ux_mode: "popup"; context: "signin" | "signup" }) => void;
  renderButton: (container: HTMLElement, options: { type: "standard"; theme: "outline"; size: "large"; text: "signin_with" | "signup_with"; width: number; shape: "rectangular"; locale: string }) => void;
  cancel: () => void;
}

export function googleIdentityApi(value: unknown): GoogleIdentityApi | null {
  const api = z.object({ initialize: z.custom(value => typeof value === "function"), renderButton: z.custom(value => typeof value === "function"), cancel: z.custom(value => typeof value === "function") }).safeParse(value);
  return api.success ? value as GoogleIdentityApi : null;
}
