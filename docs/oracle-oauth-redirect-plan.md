# Oracle OAuth redirects — PREPARED ONLY, no Console/DNS/provider change

The source non-secret Auth export and owner supplement are verified, with G3 closed. Only the primary Google public client ID is configured; the owner confirms no additional IDs. Its value stays in the private handoff, not this document. Source GitHub and the other exported OAuth providers are disabled; do not enable them or invent credentials.

Google remains disabled on the disposable rehearsal instances. This document is configuration preparation, **not a claim of a real Google login**. No client secret, signing key or provider setting has been copied or changed. Keep GIS hashed-nonce verification and the flag-protected redirect fallback. No paid Supabase auth-domain add-on is needed or authorised.

## Exact Google Console entries for the owner, when the G4 batch is released

In the existing Google Cloud project's Google Auth Platform, select the existing web OAuth client matching the private primary client ID. Keep its existing entries; add only the reviewed entries below. Do not create a paid project or change credentials.

| Use | Authorised JavaScript origin (no path) | Authorised OAuth redirect URI |
| --- | --- | --- |
| Oracle staging | `https://staging.ir35careers.com` | `https://api-staging.ir35careers.com/auth/v1/callback` |
| Oracle canonical production | `https://www.ir35careers.com` | `https://api.ir35careers.com/auth/v1/callback` |
| Bare-domain sign-in compatibility | `https://ir35careers.com` | Same production callback above |
| Existing admin Google flow | `https://admin.ir35careers.com` | Same production callback above |

The app's `/auth/callback` is a GoTrue post-login redirect, **not** the Google provider callback. The self-hosted GoTrue redirect allowlist must include only the app's reviewed exact URLs, for example `https://staging.ir35careers.com/auth/callback` during staging and the canonical production equivalent after cutover. Current server admin fallback explicitly redirects to `https://admin.ir35careers.com/`; include that exact post-login destination in the later owner-reviewed GoTrue production allowlist, not in Google's provider-callback list. Test the real flows and their permitted query/path variants before release. Do not introduce wildcard origins or a broad redirect allowlist.

Keep the existing cloud callback `https://kxcbgflleqnjzjbkevwd.supabase.co/auth/v1/callback` throughout the 14-day rollback retention. Removing it would impair rollback. Do not switch the live OAuth flow, DNS or production environment before exact **YES CUTOVER** and all release gates. Retain any already-authorised credential-free preview origin only if still required; do not invent or copy preview secrets.

Read-only source inspection confirms `src/lib/google-oauth.ts` uses the SAME Google provider with an explicit admin origin, and `src/proxy.ts` rewrites the admin host's root/login to admin routes. Include the admin origin in the owner's existing-client review, but real admin Google/session isolation still needs protected browser proof. The source GitHub provider is disabled; do not silently enable it. Separately, the server redirect fallback canonicalises non-admin production-mode origins to `www`; staging fallback must be explicitly tested/fixed before provider activation, never allowed to send staging sessions to production as an unreviewed workaround.

## Consent branding checklist, owner-only G4 action

Confirm the existing app's display name is **IR35 Careers**, its logo is the approved project asset, its authorised domain is `ir35careers.com`, and its privacy/terms links point to the live reviewed pages. This is a free settings task, not permission to submit an agreement, publish an unreviewed app or upgrade a plan. The owner completes any login/MFA/verification; no credentials, client secrets or verification codes in chat or screenshots.

## Proof still required before cutover

- A real owner-operated Google sign-in on the protected Oracle staging origin after the exact origin/callback entries are approved; do not substitute a mocked token for provider proof.
- GIS nonce generated client-side, hashed for Google, original nonce checked by `signInWithIdToken`; nonce checking stays enabled. The redirect fallback remains behind its flag.
- Callback session/cookie/redirect/noindex behaviour and logout, without a production write or real employer submission.
- Production SMTP credentials are a later owner-secret gate; staging stays on the private sink. No real mailbox test is authorised now.

This list joins the single final owner batch; no Google Console action is requested mid-phase.
