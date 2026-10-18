# P0.9 — authentication and application context audit

Audit 18 October 2026, source `1ee7346`; **not an implemented fix**. The full P0.9 requirement remains open.

## Verified gaps

1. No `src/app/auth/callback` route/page exists. An unauthenticated HEAD to `https://www.ir35careers.com/auth/callback` returned **404**. No token or email was sent by this check.
2. `signUpWithPassword` in `src/lib/auth-context.tsx` sets `emailRedirectTo` to the browser origin plus the final destination, not the required canonical dedicated callback. Password reset likewise derives its origin from the browser. The Google helper independently canonicalizes origins but still targets the final page. Keep the admin Google path separate when implementing a customer callback.
3. `SignInForm` has no confirmation-resend action or dedicated expired-confirmation recovery state. It shows a Check your inbox screen after signup. An expired/consumed link must get an explicit, safe recovery route without exposing token/error query details as trusted content.
4. The submission and Auto Apply handlers authenticate users, but contain no explicit `email_confirmed_at` gate. Supabase's own login policies are not a substitute for the brief's server-side requirement before applying. A confirmed combined/phone timestamp or user-editable metadata must not be treated as verified email.
5. `WorkspacePage` redirects logged-out users with only `window.location.pathname`, losing the query/hash. `SignInForm` shows generic account copy, not the saved job/company apply intent. Existing `resolvePostAuthPath` protects allowed internal destinations and must remain the redirect boundary; do not trust query-supplied employer/title text as job facts.
6. `/profile#apply-settings` sets the settings tab in a hash effect, but `firstTimeResumeRequired` still returns the CV-upload screen regardless of that tab. This explains the observed deep-link override for an account without a primary CV.

The reported `otp_expired` is **not attributed solely to a host redirect**: link expiry, prior consumption and email security scanning remain unproven possibilities. Do not log or reuse a customer's confirmation link to diagnose it.

## Implementation and verification still required

- One canonical customer callback builder, preserved safe next/job context, a real no-store callback page, correct SDK session/code handling and a helpful expiry/resend path. This app currently uses a browser-storage supabase-js client, not a cookie-based SSR client; do not add an incompatible cookie-only exchange or replay an already-consumed code.
- Server-side confirmed-email gates for manual and scheduled Auto Apply without bypassing tenant, lifecycle, approval or receipt checks; test unconfirmed/OAuth/phone-only/spoofed metadata cases and zero enqueue/application side effects on rejection.
- Contextual sign-in using actual public job data, safe return queries, expiry/resend browser tests and the Apply settings deep-link regression when no CV exists. Use mocks/test identities; no real employer submission or unsolicited emails.
- Inspect the project's actual auth redirect allowlist/custom-domain status privately. A Supabase custom auth domain and Google branding require verified provider/DNS settings and may have a paid activation gate. Do not purchase or activate a paid option without owner direction; no custom domain is claimed configured.

## Primary references reviewed

[Supabase signup confirmation resend](https://supabase.com/docs/reference/javascript/auth-resend), [email templates and scanner caveats](https://supabase.com/docs/guides/auth/auth-email-templates), [SDK initialization/session detection](https://supabase.com/docs/reference/javascript/auth-initialize), [browser versus cookie/header authentication packages](https://supabase.com/docs/guides/auth/choosing-a-server-package). These guide the next patch; they are not evidence that this project has been configured or released.

No authentication, DNS, provider, database or production settings were changed by this audit. Migration 025/compatible web rollout and the worker-capacity gate remain separate pending work. Phases 0–7 remain the objective.
