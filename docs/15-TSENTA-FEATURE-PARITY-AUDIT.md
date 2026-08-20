# IR35Careers — Tsenta feature-parity audit

Audit date: 20 August 2026  
Reference: public pages on `https://tsenta.com/`, including its jobs directory and a public job-detail page. Authenticated or private areas were not bypassed.

This ledger separates working product behaviour from provider-dependent integrations. IR35Careers must not present a dry run, local preview, or unconnected provider as a completed live service.

| Capability seen in the reference | IR35Careers state | Evidence / boundary |
|---|---|---|
| Public job discovery, filters and pagination | Live | `/jobs`, `/api/jobs/search`; IR35, workplace, rate, recency, skills, location and sorting |
| Public job detail and original-source handoff | Live | `/jobs/[id]`; status evidence, freshness, rate, source and explicit handoff |
| Dashboard and role matching | Live | `/dashboard`; deterministic profile-to-role scoring with an inspectable 55/20/15/10 skills, rate, IR35 and workplace breakdown, plus a no-score state when structured skill overlap is absent |
| Application and pipeline analytics | Live | `/analytics`; account-owned funnel, response/interview/offer rates, source/IR35/workplace mix, activity, review signals and privacy-bounded CSV export |
| Paste an external role URL | Live | `/analyse-job`, `/api/jobs/preview`; public HTTPS only with SSRF and size controls |
| CV analysis and role-specific score | Live | CV Studio; transparent scoring categories and evidence |
| Missing-keyword identification | Live | Missing terms are labelled as absent and never converted into claimed experience |
| Suggested edits and truth-preserving rewriting | Live | Suggestions require contractor verification and approval |
| Side-by-side approval | Live | Original and proposed content remain visible before building a version |
| CV version history | Live | Browser storage for previews and account-owned persistence when signed in |
| PDF and DOCX export | Live | Client-requested export from an approved CV version |
| Cover letter and screening preparation | Live | Application workspace; every generated/selected answer is reviewable |
| Application receipt and tracker | Live as dry run | A receipt and tracker entry are created without transmitting an application; the receipt preserves the reviewed CV label, CV text, cover letter and screening-answer snapshot, and supports account-owned accuracy/change feedback |
| Automated ATS submission | Provider gate | Adapter boundary exists; live submission is deliberately disabled until ATS-specific credentials, consent and verification exist |
| Recruiter inbox and reply classification | Product surface + provider gate | Inbox, linking and deterministic classification exist; real inbound email/SMS/WhatsApp delivery needs approved providers |
| Saved searches, curated list and alerts | Live workspace + delivery gate | Searches are account-owned and each alert can load a cancellable, stale-safe preview of its latest live matches; outbound email delivery remains visibly provider-gated |
| Subscription/credit controls | Provider-ready, safely gated | Hosted Stripe Checkout, customer portal, explicit consent record, signed idempotent webhook ledger, entitlement downgrade rules, billing policy and charge-safe account deletion exist; the paid plan stays hidden/disabled until delivered benefits and complete production configuration pass acceptance checks |
| Responsive web app | Live | Desktop, tablet and mobile layouts |
| Installable mobile experience | Live PWA | Manifest, app icons, service worker and offline recovery page |
| Browser helper | Developer preview | Minimal-permission Chrome extension ZIP; not represented as Chrome Web Store approved |
| Public developer access | Live, read-only | `/developers`, `/api/jobs/search`, downloadable CLI helper |
| Native iOS/Android apps | Not connected | PWA covers installable mobile use; native-store builds require separate signing and review |
| iMessage, WhatsApp and SMS | Provider gate | Requires approved provider accounts, user consent, verified sender identity and message-retention policy |
| MCP server | Live, read-only | Downloadable Node.js MCP server; protocol-tested public search, contract detail, URL analysis and IR35 evidence tools with no account or write scope |
| Networking and referral preparation | Live, user-controlled | `/network`; account-owned contacts, follow-up queue, role-linked editable drafts, review gate, manual copy and JSON export. No message is sent by IR35Careers |
| Autonomous networking/referral outreach | Not connected | Social-network discovery, profile scraping and unsupervised messaging are deliberately not claimed |
| Account sign-up/sign-in/reset | Live | `/account`, `/account/reset` with Supabase Auth |
| Work-authorisation and sponsorship answers | Live, user-declared | Profile records UK right-to-work/sponsorship state without inferring it from nationality or CV text; the value becomes a review-required screening answer |
| Data export and permanent account deletion | Live | `/settings`, `/api/account`; authenticated export and explicit email-confirmed deletion |
| Pricing, changelog, AI disclosure, security and legal pages | Live | Public trust and product pages linked in the footer and sitemap |

## Release rule

A provider-gated row may become **Live** only after the integration has: valid production credentials, least-privilege scopes, consent and revocation controls, audit events, retry/idempotency handling, redacted error logs, provider sandbox tests, a manual end-to-end test, and an updated privacy/retention disclosure.

## Credentials still required for provider-dependent parity

- Approved transactional/inbound email provider and verified sending domain.
- ATS-specific partner credentials or documented application APIs; browser scraping and CAPTCHA bypass are out of scope.
- Stripe secret key, recurring product/price ID, webhook signing secret, approved VAT-aware display price and optional customer-portal configuration if paid plans are enabled.
- WhatsApp Business/SMS provider approval and consent records if messaging is enabled.
- Apple/Google developer accounts only if native store apps are commissioned.
- Chrome Web Store developer account only for store distribution of the reviewed extension.

No credential should be pasted into chat or committed to Git. Use Vercel environment variables and provider secret stores.
