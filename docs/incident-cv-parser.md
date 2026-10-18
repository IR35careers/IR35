# Phase 0 CV identity incident — branch fix, not deployed

The original private PDF is not available in this task. The following synthetic extraction reproduces both reported wrong fields without reading a contractor's document or changing production data:

```text
Cloud Platforms
RBAC, IAM
A L E X   M O R G A N
Senior DevOps Engineer
alex@example.com | +44 7700 900123 | Bristol, UK

TECHNICAL SKILLS
AWS, Terraform, Kubernetes
```

Calling `extractResumeProfile` at baseline `3eb721d` on 18 October returned `fullName: "Cloud Platforms"` and `location: "RBAC, IAM"`. This establishes the text/identity defect, not a claim to have inspected the original PDF or reproduced its exact glyph layout.

## Confirmed baseline code paths at 3eb721d

- `src/lib/resume/profile-extraction.ts`: `candidateName` accepts the first two-to-five-word alphabetic line in the first twelve lines. Its exclusions do not cover this technical heading. The real spaced name is not normalized first. `contactLocation` treats almost any short alphabetic string (including a comma-separated skills pair) in the first fifteen lines as a place, without requiring contact/location evidence.
- `src/lib/resume/normalise-text.ts`: normalization removes empty bullets/trailing whitespace only; it does not repair extraction letter spacing.
- `src/lib/resume/analysis.ts`: a second independent name heuristic also accepts `Cloud Platforms`; its singular `platform` exclusion does not match the plural. Scoring/preview can therefore disagree with profile extraction unless identity validation is shared.
- `src/components/resume/ResumeDocumentPreview.tsx`: the guessed document name currently wins over an explicitly supplied contractor name. A technical heading can reach the document header.
- `src/app/api/resume/parse/route.ts`: PDF/DOCX signatures, active-content and size checks already exist and must be preserved. A saved HTML page named `.pdf` receives only the generic invalid-PDF error; HTML named `.txt` currently enters the plain-text path. Neither case explains downloading the actual CV from SharePoint instead of saving the web page.
- `ContractorProfile` deliberately keeps existing non-empty profile facts when importing. Preserve that behaviour; do not silently replace or delete stored customer identities while fixing extraction.

## Required patch and verification

1. Share conservative name validation between profile extraction and analysis/preview. Reject technical headings, skills lists and obvious places; retain Unicode names, hyphens/apostrophes and legitimate initials. Do not rely on a dictionary of Western given names.
2. Normalize evidenced extraction letter spacing before identity/section detection, preserving real word boundaries. If the original boundaries are unrecoverable, leave the name for explicit review rather than guessing a split or falling back to a heading. Preserve original facts and ordinary prose/technical acronyms.
3. Require location evidence: a contact segment, explicit location/address label, postcode or recognized place. Do not treat a role/skill heading, an arbitrary alphabetic sentence or a remote-work preference as the contractor's home location.
4. Use the explicitly supplied contractor identity for CV presentation/labels, with a validated document-name fallback and a neutral CV title when unknown. Do not mutate old profile records automatically.
5. Sniff saved HTML before type-based parsing and return specific, safe guidance to download/export the real PDF/DOCX. Never fetch a URL from the uploaded page. Keep signature checks, active-content rejection, decompression/page/size limits and private no-store responses.
6. Add actual generated-PDF route coverage alongside text regressions; distinguish literal spaced text from PDF glyph-layout reproduction. Test valid PDF/DOCX, spoofed signatures, HTML under PDF/TXT filenames, ambiguous identity, international/initialled names, technical headings, explicit/uncommon locations and existing identity precedence. Use synthetic fixtures only. Keep the checkbox/tab/answer/auth fixes separate.

## Implemented in the CV-parser branch

- Structured PDF.js text items preserve explicit word separators **before** letter-spacing repair. Two actual generated PDFs reproduce literal spaces and PDF character spacing, with technical headings painted before the identity despite a different visual reading order. Both route tests now return the actual synthetic person's name and Bristol, UK. The tests were not weakened to accept missing names when the PDF has recoverable boundaries.
- Shared identity validation is used by profile extraction, CV analysis, preparation-name resolution, previews and exports. Technical headings/places/prose are excluded, contact/label evidence is required for unknown towns, and a lone postcode no longer manufactures an address from preceding skill lines.
- Explicit personal identity wins over document heuristics. Metadata titles, download names and the relevant CV labels use the person's name and **CV**. The export API validates its body with Zod and uses the **resolved** name in Content-Disposition, not a rejected incoming heading. Existing profile identity/contact facts remain untouched by import; a suspected old technical-heading name gets a review notice.
- Saved HTML is detected before PDF/DOCX/TXT branching, including a UTF-8 BOM and leading saved-page comment. The error explains Download/Export in SharePoint; no URL in a file is fetched. PDF/DOCX signatures, active-content, page, entry, decompression, byte and text limits stay in place. PDF loading tasks are released in finally.
- Ambiguous or missing identities generate a visible review warning in each upload flow, not a false Word-formatting message. Export refuses a heading-only identity. Initials, Unicode identity validation, ordinary technical acronyms and existing explicitly supplied names have regression coverage. This is not a claim of new multilingual PDF font coverage; export fonts are unchanged and belong to the fuller CV phase.

Final local release verification passed 570 tests/115 files, all 199 legacy checks, TypeScript and ESLint, including the normalization refactor and whitespace-only formatting pass. Production-mode Playwright passed six existing analysis/export/application flows across all three viewports; the new synthetic-PDF/HTML upload journey then passed on all three viewports after correcting two test-only locators (Next route-announcer collision and the actual Version name label). Assertions and accessibility rules were retained. Production builds passed as part of these isolated, credential-free previews. Final-head CI and merge are still pending.

P0.3 stays unchecked until the separate PR's full verification passes; it is not a production fix merely because local tests pass. No migration, hosted role, Railway setting, production deployment or runner flag has changed. The verified-backup/passphrase and literal YES CUTOVER gates remain unchanged.

First-head CodeQL correctly flagged the new profile-domain substring contact check. The patch now parses each contact token and checks exact LinkedIn/GitHub hostnames; domains or paths merely containing those names do not establish contact context. All 31 focused identity/extraction checks pass, including spoofed-host regressions. No alert suppression or security exception was added; final-head CI remains required.
