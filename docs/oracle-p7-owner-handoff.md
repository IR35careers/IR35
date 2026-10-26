# P7 owner batch — source Auth settings only

## G3 CLOSED — no further owner export or hand-copy action

Owner completed the supplement once and confirmed token revocation. Its reported SHA256 `79b4842204e05b9c4b4d05812ed8f97975928f1bb58bb3ba4013d5389c76727a` matches locally; both fields have an actual `explicit_null` API observation. Owner explicitly confirms NONE for both public settings. A byte-identical, read-only, owner-only API archive is retained; the supplement keeps those observations and separately records the owner decision. Effective settings now contain the two owner-authorised empty strings, with updated SHA256 `fc936b56f693bd432486ac0cac28c55b0ce473932f4476c1b0fe1c856306fb95`. Original full export unchanged. [Evidence](evidence/oracle-g3-owner-confirmation-20261026.json).

No further token, re-export or manual copy is requested. Continue staging P7/P8 and P9 preparation under RESUME; batch any other owner-only items once at the end. Runtime/provider/restore/load gates are separate and not implied PASS by G3 closure. No production, DNS, provider, IAM or real-secret change and no cutover. The command instructions below are historical; do not run them again.

## Current owner action: ONE supplement command, no manual copy

Owner confirms completion and token revocation. The private export passed local schema/type/ACL checks: 140 fields, 117 populated, 23 null. Its SHA256 is `b6f708f921a730b8e07e5c2e77052318207900d06b3d855d9b45fa28f2a959c9`. No second API call was made; the populated original is preserved. Twenty-one nulls belong to disabled providers and require no client credentials.

The owner superseded manual copying. Create a short-lived read-only Supabase personal token and run this **one command** in a normal Windows PowerShell window:

```powershell
& 'C:\Python314\python.exe' 'C:\Users\anves\.codex\worktrees\bot-handoff\ir35careers\infra\oracle\fill_auth_supplement.py'
```

Enter the token only at the hidden prompt. The command makes at most ONE GET to the same fixed config/auth endpoint through the unchanged TLS/no-redirect/no-proxy/no-retry transport. It never changes Supabase settings. Revoke the token immediately afterwards; reply **“Supplement complete; token revoked”** on success, or **“Supplement failed; token revoked”** on failure. Do not rerun automatically or send any token/file contents here.

Only `password_required_characters` and `external_google_additional_client_ids` can be filled in the existing owner-only `C:\Users\anves\.oci\ir35-p0-readonly\oracle-auth-settings-supplement.json`. The original export is never rewritten. Its binding, protected ACL, file type and SHA are verified before prompting and before replacement. Populated strings/lists (including empty ones) and previously attested nulls are never overwritten; when both fields are complete there is no prompt or request. Concurrent changes fail closed; an exclusive lock prevents two writers.

Password character classes are public strings and are preserved exactly, including punctuation. Additional Google client IDs may be a public string or an array of strings; both shapes, including empty values, are preserved without coercion. All existing credential-field exclusions remain unchanged, and every accepted string/list element still receives the original credential-pattern checks. [API field reference](https://supabase.com/docs/reference/api/v1-get-auth-service-config).

The old raw response was deliberately discarded, so its exact types cannot be recovered. Offline tests prove punctuation/empty strings were already accepted, lists were nulled, and absent/explicit-null/invalid/unsafe results were conflated. The new `source_observations` metadata records fixed field names/types/states only. An explicitly present API null stays null, labelled `explicit_null`; it is not guessed as an empty string or treated as an absent field. Missing, malformed or unsafe fields fail rather than silently relaxing a policy. Per-attempt intent/result journals in the same private directory are exclusive, owner-only and contain no values, raw response or credentials.

Stdout remains only `field_count`, `null_fields`, `file_sha256`. Exit0/field_count2 means success; `null_fields` may name an explicitly attested source null, not an export failure. Exit1/field_count0 means STOP, with the original/supplement values preserved and fixed diagnostic metadata available locally. No raw errors or secrets are printed.

This validates a source handoff, not runtime parity. After the owner-run handoff, continue authorised P7/P8 and P9 preparation under RESUME; collect remaining owner-only items into one end batch. Actual Auth/provider tests and full containment remain required, with hard stops for mismatches/cost/disallowed changes. No production/provider/DNS/IAM/real-secret changes or cutover. Earlier full-export instructions below are retained history, not a request to rerun the completed export or use its historical window wrapper.

## Owner-selected read-only export (preferred)

Use the ONE local standard-library [exporter](../infra/oracle/export_auth_settings.py), not manual copy first. It uses only the fixed GET endpoint documented by [Supabase](https://supabase.com/docs/reference/api/v1-get-auth-service-config), with the narrow `auth:read` / `auth_config_read` permission where available. The owner creates/revokes the short-lived personal token; the script never creates or revokes tokens or changes settings.

In a normal Windows PowerShell terminal, run exactly:

```powershell
& 'C:\Python314\python.exe' 'C:\Users\anves\.codex\worktrees\bot-handoff\ir35careers\infra\oracle\export_auth_settings.py'
```

Enter the personal token ONLY at its hidden prompt, never as an argument, environment variable, pasted command or chat message. The exporter refuses an echoing fallback prompt, redirects, retries and unrecognised response types. It reads no saved token. Proxy environment settings are not used; HTTPS certificate verification remains enabled.

Destination is the EXISTING owner-only file `C:\Users\anves\.oci\ir35-p0-readonly\oracle-auth-settings.json` (the requested path's missing slash before `.oci` is corrected). Its output uses **`settings` keyed by explicit Management API field names plus `missing_fields`**. This supersedes the earlier blank hand-copy format; no operational GoTrue env is applied automatically. Null means missing, unsupported or unsafe, never an inferred default. Disabled providers can legitimately have null public client IDs. All JWT fields, including expiry, are deliberately omitted to honour the owner's no-JWT-field rule; JWT/provider/SMTP/hook credentials are never exported. No hook URLs are copied.

The raw response is kept only in process memory and never written. Only allowlisted scalar values enter the export. Unknown/credential fields and nested structures are discarded, and token/JWT/credential-URL content inside an otherwise allowed string becomes null for manual review. Unrendered template placeholders are retained unchanged.

The script accepts no arguments. It verifies the existing destination's custody and blank state BEFORE prompting. It preserves any nonblank handoff; creates a unique temporary file in the same directory, verifies owner-only ACL BEFORE writing, fsyncs, checks that the destination did not change, atomically replaces only the blank file, and verifies ACL/SHA read-back. No output file is replaced on a failed request. A successful export cannot be silently overwritten by a second run.

**Output is only three JSON fields:** `field_count`, `null_fields` and `file_sha256`. Exit0 means the export was written/verified. Exit1 means STOP: the JSON has field_count0/file_sha256null and lists all allowlisted names for manual copy; do not retry automatically. Existing handoff bytes remain untouched on request failure. No raw error, HTTP body, header, setting value or token is printed.

Revoke the token immediately after that one attempt. Reply **“Auth export complete”** on success, or provide only the null-field names/metadata on failure; never paste the file or token. The agent can privately inspect exported non-secret configuration after the handoff. No live request was made by the agent while implementing/testing this tool.

## Manual fallback only if export fails or fields are unavailable

The one approved read-only inventory and complete containment PASS. Staging is still read-only/mock/SMTP-sink; this is **G3**, not a request for cutover or live provider credentials.

## One handoff, no cloud changes

1. Open the existing Supabase project's **Authentication** dashboard. Read only; do not change/save cloud settings. Use URL Configuration, Email Templates, Providers/Sign In, Rate Limits, Sessions, Password/MFA and security-hook settings.
2. Fill the non-secret settings and five **unrendered template sources + subjects** in the owner-only private file `C:\Users\anves\.oci\ir35-p0-readonly\oracle-auth-settings.json`. Its public blank format is [here](../infra/oracle/auth-settings-handoff.example.json). Preserve the units displayed by the dashboard. Leave anything unavailable `null` and list its name under `settings_not_visible_in_dashboard`; never guess a default.
3. Reply **“Auth settings ready”** when saved, or list only the names of inaccessible settings. Do not paste the file or its values into chat. The agent will read/validate it privately, transfer approved non-secret configuration over pinned SSH to a600/ir35 `.env*` handoff on the VM, and report names/completeness/hashes only. No automatic application of unverified values.

The one batch covers:

- Site URL/exact redirect allowlist; email/signup/confirmation/magic-link/secure-email-change behaviour and OTP timing/length.
- Confirmation, magic link, recovery, invite and email-change subjects and original HTML, not received messages or actual verification links.
- Every visible rate limit and its units; refresh rotation/reuse and session lifetime/inactivity/single-session controls. JWT fields are omitted from the owner-selected export entirely; never copy signing material.
- Password/MFA/security-hook/captcha/notification controls and which providers are enabled. Public Google/GitHub client IDs are sufficient for this inventory; never copy their client secrets.
- SMTP host/port/sender metadata only. Staging continues using the sink regardless of these values. Do not copy SMTP passwords/usernames or send real mail.

**Never include:** passwords, API/anon/service keys, JWT signing secrets, OAuth client secrets, SMTP credentials, captcha secrets, access/refresh tokens, actual email verification links, MFA/recovery codes or private keys. Fresh Oracle signing material is retained; cloud signing secrets must not be migrated. No token search or credential retrieval is requested.

The checklist [maps source settings to pinned GoTrue names](oracle-auth-checklist.md). Template env variables take internal template URLs, not inline HTML; the handoff preserves HTML separately for review. Provider and Google Console/DNS changes remain owner-gated. Missing values are not a pass, and historical P4 Auth tests do not substitute for new P7 verification.
