# IR35Careers product parity audit

This audit maps the supplied reference screens to the implemented IR35Careers product. It records functional equivalence rather than copying another company’s brand, wording or unsupported claims.

| Reference | IR35Careers implementation | Backend and persistence | Status |
| --- | --- | --- | --- |
| Research feed | `/research` editorial feed and IR35 resources | Published application routes and curated content | Complete |
| Resume editor | `/profile` resume profiles, templates, fonts, size, alignment, section visibility, one-page mode and live preview | Private `profiles.application_profile` JSON, row-level access controls | Complete |
| Resume analysis | Role score, missing keywords, evidence-led suggestions and side-by-side approval | Deterministic analysis plus optional OpenRouter enhancement | Complete |
| Resume versions | Named versions, restore, delete, approve, PDF and DOCX export | Private resume/version records and account export | Complete |
| Cover letter | Reusable base letter, role-specific generation, editable preview and verified candidate signature | Private profile and application packet storage | Complete |
| Apply settings | Off, Honest and Strong optimisation; safe-edit preference; review and cover-letter controls | Persisted in the private contractor profile | Complete |
| Memory | Customer-visible list of saved application facts and preferences | Private contractor profile with edit and deletion controls | Complete |
| Job sources | Central public-source discovery with no customer job-board password required | Scheduled source ingestion, duplicate reduction and source monitoring | Functionally equivalent |
| Account connections | Customer-facing discovery, private email and application-runner status | Authenticated integration-status endpoint; secrets never exposed | Complete |
| Email integration | Per-user private application address, recruiter inbox, classification, forwarding and replies | Signed inbound webhooks, owner-only messages and delivery controls | Functionally equivalent |
| Referrals and networking | Contact map, follow-up stages, role-linked referral drafts, review and copy workflow | Private profile storage and account export | Complete for networking |
| Job detail | Full listing, IR35 evidence, skills, rate, location, source and application action | Live job records with source snapshot | Complete |
| Job discovery | Search, IR35, workplace, seniority, rate and keyword filters; saved alerts | Live jobs query and user-owned alerts | Complete |
| Dashboard | Personal greeting, match cards, application journey, profile progress and tracked roles | Account profile, saved jobs and application workspace | Complete |
| First-login experience | Guided product tour with skip and replay controls | Completion saved to the private account and mirrored locally for resilience | Complete |
| Returning login | Direct dashboard routing and one-per-session welcome message | Auth routing and session-aware UI | Complete |
| Auto Apply | Role lanes, filters, daily limit, standing consent and manual run | Server-side matching, controlled browser runner and application records | Complete within supported public forms |
| Application submission | Multi-step forms, uploads, text fields, radio buttons, checkboxes and dropdowns | Confirmation detection, receipts, idempotency and bounded status recovery | Complete within supported public forms |
| Protected employer steps | Login, CAPTCHA, identity and ambiguous legal questions pause in Needs You | Fail-closed runner outcomes and customer notification | Complete |
| Application tracker | Needs You, Ready, Applied, Replied, Interview, Offer and closed states | Owner-only packets, events, CSV import and export | Complete |
| Recruiter inbox | Private address, categories, two-pane reader, compose and reply | Signed inbound mail, classification and forwarding | Complete |
| Google sign-in | Server-initiated Supabase authorization-code flow | Secure callback and dashboard/admin routing | Complete |

## Deliberate boundaries

- IR35Careers does not store employer portal passwords.
- IR35Careers does not bypass login, CAPTCHA, identity or security verification.
- Employer forms can change without notice. Unsupported or ambiguous fields pause for the customer instead of being guessed.
- Monetary referral credits are not advertised because no approved referral-reward policy or accounting ledger exists yet.
- Customer Gmail or Outlook access is not requested because the managed private application inbox provides the required recruiter-message workflow with less account access.
- A role is marked Applied only after the employer’s confirmation is detected. A prepared packet is never presented as a completed application.

## Release evidence

- Unit tests cover application state, submission, email, authentication helpers, job processing and supporting workflows.
- Legacy processing tests cover job classification, tax calculations, source aggregation and fetchers.
- The production build performs TypeScript checking and generates all public and authenticated application routes.
