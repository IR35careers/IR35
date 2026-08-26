# Transactional email runbook

IR35Careers uses two deliberately separate email paths:

1. Supabase Auth sends account confirmation and password-recovery messages through its configured Resend SMTP credentials.
2. The Next.js application sends the post-verification welcome guide through the Resend API.

The welcome message is a service email, not a marketing subscription. It is sent only to the authenticated, confirmed address and is recorded in `email_delivery_events` so it is delivered once per account.

## Required production setup

1. Apply `supabase/migrations/014_transactional_email_delivery.sql` in the Supabase SQL Editor.
2. In Supabase **Authentication → Email Templates**:
   - set **Confirm signup** subject to `Confirm your IR35Careers account` and paste `supabase/email-templates/confirmation.html`;
   - set **Reset password** subject to `Reset your IR35Careers password` and paste `supabase/email-templates/recovery.html`.
3. Keep Resend click and open tracking disabled for authentication messages. Rewriting a confirmation URL can interfere with the Supabase verification link.
4. In Vercel, set server-only production variables:
   - `RESEND_API_KEY` - a Resend key with sending permission;
   - `EMAIL_FROM=IR35Careers <hello@mail.ir35careers.com>`;
   - `EMAIL_REPLY_TO` - optional, but only use a monitored address;
   - `ENABLE_WELCOME_EMAIL=true`;
   - `NEXT_PUBLIC_SITE_URL=https://www.ir35careers.com`.
5. Redeploy after changing environment variables.

Do not put Resend or Supabase secret keys in any `NEXT_PUBLIC_*` variable or commit them to Git.

## Acceptance test

Use a new email address, not an existing account:

1. Create the account and accept the legal terms.
2. Confirm that the branded confirmation email arrives from `account@mail.ir35careers.com`.
3. Select the confirmation button and verify the site signs in or returns to the account flow successfully.
4. Confirm exactly one branded welcome email arrives from `hello@mail.ir35careers.com`.
5. Sign out and sign in again; confirm no second welcome email is sent.
6. Request a password reset and confirm the branded reset email works.
7. Check the Resend delivery log and Supabase `email_delivery_events` row without exposing message content or provider secrets.
