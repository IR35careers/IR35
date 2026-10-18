# Correct CV identity, PDF letter spacing and saved-page uploads

## What and why

Phase 0 reported a letter-spaced PDF becoming **Cloud Platforms** / **RBAC, IAM**, with a heading used as the CV title. The synthetic reproduction and baseline paths are in `docs/incident-cv-parser.md`; the original private PDF is not available and was not inspected.

Preserve PDF.js word-item boundaries before joining spaced letters, share conservative name validation across extraction/analysis/preparation/preview/export, require location evidence and prevent a lone postcode from turning skill headings into an address. Keep existing profile facts; present identity review warnings instead of silently overwriting them. Use a validated personal name for CV labels, PDF/DOCX metadata and download filenames. Unknown word boundaries require confirmation, not guessed names.

Detect saved HTML before all type branches and explain downloading/exporting the actual document from SharePoint. Never fetch its URLs. Preserve magic-byte, active-content and all processing limits; release PDF loading resources. Add Zod validation for upload/PDF-item/export boundaries, retaining bounded truncation of nonidentity labels.

## Verification

See `docs/progress.md` for exact local and final-head CI results. Regressions include two real generated PDF variants (literal spaces and PDF glyph spacing), BOM/comment-prefixed HTML under PDF/TXT filenames, initials/Unicode identity validation, heading-only and ambiguous documents, contact/address evidence, explicit identity precedence, PDF/DOCX metadata and resolved download names, and malformed export payloads. A new real-HTTP Playwright upload journey runs on phone/tablet/desktop; the existing application review checks now expect the corrected personal **CV** title. No test threshold, accessibility rule or platform skip is loosened. Screenshot review applies if a checked visual baseline changes; no layout redesign is included.

## Migrations, environment and manual gates

None for this fix. No new variable or credential. No RLS/CSP change, database migration, hosted-role setup or production flag change. Tests use synthetic CVs, the labelled local demo and mock ATS only, never a real employer or private customer document. Following an authorized coordinated release, verify upload/preview/download using `anvesh.mannuru+ir35test@gmail.com`; do not submit to an employer.

The existing Vercel Git deployment hold is retained because the parent lifecycle release still requires the owner's verified encrypted backup and database migration. Railway/Web cutover requires literal **YES CUTOVER**, not received. This PR must not deploy the parent lifecycle prematurely. P0.3 implementation/CI success is distinct from production verification.

## Rollback

Before deployment, revert the isolated CV-fix commit; the current live site is unchanged. After an authorized release, roll back the reviewed compatible web deployment, retaining the installed authoritative lifecycle schema and confirmed receipts. Do not roll back migrations or restore old browser write privileges as a CV-parser workaround.
