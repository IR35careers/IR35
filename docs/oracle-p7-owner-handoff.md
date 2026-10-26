# P7 owner batch — source Auth settings only

The one approved read-only inventory and complete containment PASS. Staging is still read-only/mock/SMTP-sink; this is **G3**, not a request for cutover or live provider credentials.

## One handoff, no cloud changes

1. Open the existing Supabase project's **Authentication** dashboard. Read only; do not change/save cloud settings. Use URL Configuration, Email Templates, Providers/Sign In, Rate Limits, Sessions, Password/MFA and security-hook settings.
2. Fill the non-secret settings and five **unrendered template sources + subjects** in the owner-only private file `C:\Users\anves\.oci\ir35-p0-readonly\oracle-auth-settings.json`. Its public blank format is [here](../infra/oracle/auth-settings-handoff.example.json). Preserve the units displayed by the dashboard. Leave anything unavailable `null` and list its name under `settings_not_visible_in_dashboard`; never guess a default.
3. Reply **“Auth settings ready”** when saved, or list only the names of inaccessible settings. Do not paste the file or its values into chat. The agent will read/validate it privately, transfer approved non-secret configuration over pinned SSH to a600/ir35 `.env*` handoff on the VM, and report names/completeness/hashes only. No automatic application of unverified values.

The one batch covers:

- Site URL/exact redirect allowlist; email/signup/confirmation/magic-link/secure-email-change behaviour and OTP timing/length.
- Confirmation, magic link, recovery, invite and email-change subjects and original HTML, not received messages or actual verification links.
- Every visible rate limit and its units; JWT TTL, refresh rotation/reuse, session lifetime/inactivity/single-session controls.
- Password/MFA/security-hook/captcha/notification controls and which providers are enabled. Public Google/GitHub client IDs are sufficient for this inventory; never copy their client secrets.
- SMTP host/port/sender metadata only. Staging continues using the sink regardless of these values. Do not copy SMTP passwords/usernames or send real mail.

**Never include:** passwords, API/anon/service keys, JWT signing secrets, OAuth client secrets, SMTP credentials, captcha secrets, access/refresh tokens, actual email verification links, MFA/recovery codes or private keys. Fresh Oracle signing material is retained; cloud signing secrets must not be migrated. No token search or credential retrieval is requested.

The checklist [maps source settings to pinned GoTrue names](oracle-auth-checklist.md). Template env variables take internal template URLs, not inline HTML; the handoff preserves HTML separately for review. Provider and Google Console/DNS changes remain owner-gated. Missing values are not a pass, and historical P4 Auth tests do not substitute for new P7 verification.
