# CV Studio implementation

Reviewed: 2026-08-19

## User journey

1. Open a contract and choose **Tailor CV to this role**.
2. Upload a PDF/DOCX/text file or paste CV text. The parser reads the document in memory and does not retain the uploaded file.
3. Review the current score, matched terms and missing terms.
4. Approve conservative edits side by side. Missing role terms remain amber and unselected.
5. To add a missing skill, explicitly choose **I genuinely have this**. Unconfirmed terms never enter the tailored text.
6. Build the approved copy, edit any line, save draft/approved versions and export PDF or DOCX.

## Published scoring rubric

The score is deterministic and is not a hiring prediction.

| Component | Weight | What is measured |
| --- | ---: | --- |
| Role keywords | 45% | Weighted coverage of listed skills and relevant description terms |
| Evidence strength | 25% | Whether matched terms appear in action- and outcome-oriented CV lines |
| Role relevance | 15% | Keyword coverage plus relevant role-title language already present |
| ATS readability | 15% | Recognisable headings, bullet structure, useful length, contact signals and line density |

The UI shows all four component scores. Job-board skills carry more weight than secondary terms discovered in the description.

## Truth-preserving rules

- Default suggestions can move already evidenced terms into the profile and remove first-person/filler wording.
- Default suggestions do not add a missing skill, employer, date, qualification, number or outcome.
- Missing terms are displayed as gaps, not inferred experience.
- A missing term enters the document only after the user confirms it; confirmed additions are placed in a clearly identifiable `VERIFIED ROLE SKILLS` section for final review.
- Users can edit the complete final text before saving or exporting.
- Every save creates a new immutable history entry; restoring a version does not overwrite its source.

## Data and privacy

- Migration `009_resume_studio.sql` creates `resume_versions` with owner-only Supabase RLS policies.
- Signed-in, configured environments save chosen versions to the user's private account history.
- Unconfigured/local preview uses browser storage only and labels that behaviour. Nothing is saved until the user presses a save action.
- The parse and export routes set `Cache-Control: no-store`, validate file/text size and do not log CV content. PDF/DOCX signatures, active PDF features, unsafe archive paths, Word macros/embedded objects, entry count and expansion size are checked before extraction.
- PDF/DOCX export is generated per request and returned directly; the server does not persist the output.

## Verification

- Unit coverage checks parsing, scoring, missing-keyword behaviour, the double acceptance/confirmation gate, and real PDF/DOCX file signatures.
- The browser journey checks sample analysis, an explicit Kubernetes confirmation, final editor content, version history, download and axe accessibility.
- PDF export was rendered with Poppler and visually reviewed after correcting footer pagination.
- DOCX export was rendered through Microsoft Word and visually reviewed because LibreOffice was unavailable on the Windows workstation.
