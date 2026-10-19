# Oracle GoTrue settings handoff — no values or secrets

Owner-approved P0 checklist, 19 October 2026. Reference candidate Auth v2.197.0; recheck against the exact pinned image in P3. A dry-run diff is not a complete configuration export. Check each setting against the source dashboard/API, then configure **only on the VM**; no production changes now.

Missing settings/templates go in an owner-only private file **outside every Git checkout**, for example under the existing owner-protected `.oci/ir35-p0-readonly` directory. Never paste the file or values into chat, a PR, issue, screenshot or CI artifact. Verify Windows ACLs; a filename alone is not protection. Do not save private material in a public bot preview. Record completion and hashes only in public docs.

| Check | Cloud/repo setting | Self-hosted Auth environment name(s) | Evidence / action |
| --- | --- | --- | --- |
| [ ] | Confirmation HTML and subject | GOTRUE_MAILER_TEMPLATES_CONFIRMATION; GOTRUE_MAILER_SUBJECTS_CONFIRMATION | Local template exists; cloud equality unverified. |
| [ ] | Magic-link HTML and subject | GOTRUE_MAILER_TEMPLATES_MAGIC_LINK; GOTRUE_MAILER_SUBJECTS_MAGIC_LINK | Owner export if API cannot read. |
| [ ] | Recovery HTML and subject | GOTRUE_MAILER_TEMPLATES_RECOVERY; GOTRUE_MAILER_SUBJECTS_RECOVERY | Local template exists; cloud equality unverified. |
| [ ] | Invite HTML and subject | GOTRUE_MAILER_TEMPLATES_INVITE; GOTRUE_MAILER_SUBJECTS_INVITE | Export even if currently unused. |
| [ ] | Email-change HTML and subject | GOTRUE_MAILER_TEMPLATES_EMAIL_CHANGE; GOTRUE_MAILER_SUBJECTS_EMAIL_CHANGE | Preserve secure double-confirm behaviour. |
| [ ] | Template verification paths | GOTRUE_MAILER_URLPATHS_CONFIRMATION; GOTRUE_MAILER_URLPATHS_INVITE; GOTRUE_MAILER_URLPATHS_RECOVERY; GOTRUE_MAILER_URLPATHS_EMAIL_CHANGE | Gateway callback paths, not the app return URL. |
| [ ] | Site URL / external Auth URL | GOTRUE_SITE_URL; API_EXTERNAL_URL | Separate staging from production. Owner DNS/Google pause remains. |
| [ ] | Additional redirect allowlist | GOTRUE_URI_ALLOW_LIST | Export exact paths/origins; no unnecessary wildcard. |
| [ ] | Email enabled / magic link / confirmation / signup | GOTRUE_EXTERNAL_EMAIL_ENABLED; GOTRUE_EXTERNAL_EMAIL_MAGIC_LINK_ENABLED; GOTRUE_MAILER_AUTOCONFIRM; GOTRUE_DISABLE_SIGNUP | Cloud confirmations enabled; AUTOCONFIRM is the inverse. |
| [ ] | Email OTP expiry/length/frequency; secure change | GOTRUE_MAILER_OTP_EXP; GOTRUE_MAILER_OTP_LENGTH; GOTRUE_SMTP_MAX_FREQUENCY; GOTRUE_MAILER_SECURE_EMAIL_CHANGE_ENABLED | Export missing exact settings privately. |
| [ ] | Google provider and GIS nonce | GOTRUE_EXTERNAL_GOOGLE_ENABLED; GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID; GOTRUE_EXTERNAL_GOOGLE_SECRET; GOTRUE_EXTERNAL_GOOGLE_REDIRECT_URI; GOTRUE_EXTERNAL_GOOGLE_SKIP_NONCE_CHECK | Enabled confirmed, credentials not exported. Never disable nonce validation. |
| [ ] | GitHub provider/import compatibility | GOTRUE_EXTERNAL_GITHUB_ENABLED; GOTRUE_EXTERNAL_GITHUB_CLIENT_ID; GOTRUE_EXTERNAL_GITHUB_SECRET; GOTRUE_EXTERNAL_GITHUB_REDIRECT_URI | Repo has a GitHub flow; enabled switch/secret unverified. |
| [ ] | Any other enabled providers | GOTRUE_EXTERNAL_<PROVIDER>_ENABLED; _CLIENT_ID; _SECRET; _REDIRECT_URI | Inventory dashboard switches, not just identities in use. Verify exact provider-specific fields against pinned source; do not enable unused providers. |
| [ ] | Email/verify/token-refresh/OTP/SSO/anonymous limits | GOTRUE_RATE_LIMIT_EMAIL_SENT; GOTRUE_RATE_LIMIT_VERIFY; GOTRUE_RATE_LIMIT_TOKEN_REFRESH; GOTRUE_RATE_LIMIT_OTP; GOTRUE_RATE_LIMIT_SSO; GOTRUE_RATE_LIMIT_ANONYMOUS_USERS | Preserve source values, don't copy example defaults. |
| [ ] | SMTP credentials and sender | GOTRUE_SMTP_HOST; GOTRUE_SMTP_PORT; GOTRUE_SMTP_USER; GOTRUE_SMTP_PASS; GOTRUE_SMTP_ADMIN_EMAIL; GOTRUE_SMTP_SENDER_NAME | SMTP enabled/source sender configured. Staging **sink only**, no live outbound credentials; future live port587. |
| [ ] | JWT TTL/audience and fresh signing material | GOTRUE_JWT_EXP; GOTRUE_JWT_AUD; GOTRUE_JWT_SECRET | New JWT secret/service key in /opt/ir35/.env600 and password manager only; never copy cloud signing secrets. |
| [ ] | Refresh rotation/reuse and session expiry | GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED; GOTRUE_SECURITY_REFRESH_TOKEN_REUSE_INTERVAL; GOTRUE_SESSIONS_TIMEBOX; GOTRUE_SESSIONS_INACTIVITY_TIMEOUT; GOTRUE_SESSIONS_SINGLE_PER_USER | Explicitly invalidate copied refresh/session state; fresh JWT secret alone is insufficient. |
| [ ] | Password policy / TOTP | GOTRUE_PASSWORD_MIN_LENGTH; GOTRUE_PASSWORD_REQUIRED_CHARACTERS; GOTRUE_MFA_TOTP_ENROLL_ENABLED; GOTRUE_MFA_TOTP_VERIFY_ENABLED | TOTP switches enabled in source metadata. Preserve identity/password hashes; no resets. |
| [ ] | Captcha/security hooks/notifications if configured | GOTRUE_SECURITY_CAPTCHA_ENABLED; GOTRUE_SECURITY_CAPTCHA_PROVIDER; GOTRUE_SECURITY_CAPTCHA_SECRET; provider-specific GOTRUE_HOOK_* and GOTRUE_MAILER_NOTIFICATIONS_* | Export enabled controls privately and verify exact fields; never solve captcha or silently remove a control. |

Template variables take **URLs**, not inline HTML. Serve reviewed exported templates through an internal-only static listener on the private Compose network; no public template/secret endpoint. Confirm the exact gateway URL and placeholder semantics in staging. This is not a new public service or permission to publish templates.

P7 evidence must cover test-account password login, confirmation, magic link, recovery, invite/email-change, Google GIS/redirect fallback/nonce, GitHub compatibility, SMTP sink capture and later approved live sender verification. Preserve password hashes and identities, invalidate sessions and show exactly **“Please sign in again”**. Never claim a provider login from an offline mock. Wipe only the explicitly identified staging DB after each rehearsal/after cutover, not a promoted production volume.

Sources: [pinned GoTrue example](https://github.com/supabase/auth/blob/v2.197.0/example.env), [pinned configuration structs](https://github.com/supabase/auth/blob/v2.197.0/internal/conf/configuration.go), [official self-hosted Compose](https://github.com/supabase/supabase/blob/master/docker/docker-compose.yml). Environment names are interface mappings; actual private source settings remain unverified until checked off.
