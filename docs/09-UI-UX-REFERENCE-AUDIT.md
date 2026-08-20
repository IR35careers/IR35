# UI/UX reference audit

Reviewed: 2026-08-20
Viewports captured: 390x844, 768x1024 and 1440x900.  
Method: live public URLs checked through web access and headless Chrome. The in-app browser runtime failed before tab creation, so logged-in interactions and screen-reader trees were not claimed as verified. PDF screenshots were reviewed for product-flow context only.

Reference captures remain under `tmp/ui-audit/` during implementation and are never shipped in the product.

## Current IR35Careers

- **Source:** https://www.ir35careers.com/
- **PDF:** page 1 describes the target product; the PDF otherwise shows reference-product screens.
- **Journey:** arrive -> understand aggregation promise -> join waitlist or preview roles.
- **Hierarchy:** restrained brand, status pill, large two-line promise, three benefits, waitlist card.
- **Motion:** ambient gradient drift and staged entrance in the repository implementation.
- **Responsive:** tablet stacks cleanly; the 390px capture clips the headline, body, top action and form area horizontally. Desktop leaves most of the viewport empty while product functionality is hidden behind the waitlist.
- **Accessibility:** strong text contrast and labelled email; clipping and completed countdown undermine comprehension. Repeated animation must remain reduced-motion aware.
- **Performance:** the live hero is visually light, but client auth, motion and waitlist queries are unnecessary for a public landing route.
- **Adapt:** quiet emerald identity, plain contractor promise and real live-job count.
- **Do not keep:** expired launch state, pricing promise without confirmation, horizontal clipping or forced registration before discovery.
- **IR35Careers interpretation:** a server-first public homepage that searches real jobs immediately, followed by practical IR35 guidance and tools.

## Tsenta public site and PDF dashboard

- **Source:** https://tsenta.com/ and https://tsenta.com/#workflow
- **PDF:** pages 1-24 cover sign-up, onboarding prompt, job dashboard, auto-apply, tracker/inbox, private email, pipeline, profile/resume, settings and pricing.
- **Journey:** benefit-led landing -> product proof -> find/prep/apply/track explanation -> pricing -> FAQ -> sign-up. Dashboard journey is browse -> inspect side panel -> prepare/submit -> route email -> track outcome.
- **Hierarchy:** exceptionally direct headline, compact evidence, paired primary/secondary actions and a large product preview. Product screens use a thin top nav, filter chips, colour-coded cards and contextual side panels.
- **Motion:** public story uses progressive demonstrations; dashboard screenshots imply drawers, filters, tabs, queue progress and state transitions.
- **Responsive:** desktop and tablet maintain clear hero/product relationships. The 390px public capture shows the secondary CTA and platform row extending past the viewport; this pattern should not be copied. The supplied dashboard screenshots are desktop-only and cannot establish mobile readiness.
- **Accessibility:** clear action labels and status text are useful; very small dashboard typography, pastel status colours and dense chips require contrast/zoom testing. Colour must not carry application state alone.
- **Performance:** the public page contains many product demonstrations and long content; IR35Careers should preserve the narrative structure with fewer client-side effects.
- **Adapt:** benefit-first copy, product evidence, staged workflow, contextual job-detail panel on desktop, explicit human approval and submission receipts.
- **Must not copy:** name, language, exact layout, illustrations, company logos, pricing, application claims or proprietary automation behaviour.
- **IR35Careers interpretation:** “Discover, understand, prepare, track” centred on IR35 provenance and UK contract rates. Advanced automation stays feature-flagged and review-first.

### Current public-site verification and supplied-screen mapping

The live public site was checked again on 2026-08-19. Its current public narrative exposes find, role-specific preparation, ATS submission receipts, tracking, recruiter-message routing, multi-surface access, volume pricing, FAQ and public blog/legal routes. The supplied PDF pages 2-24 add dashboard screens for onboarding source capture, job detail/openings, job-card and tracker views, auto-apply filters, networking, CV/profile editing, work authorisation, job-board connections, referrals, email integrations, private forwarding address, inbox filters and pipeline analytics.

The live public site and linked product pages were rechecked on 2026-08-20. The current surface additionally makes native mobile apps, iMessage/WhatsApp, Chrome, OAuth MCP, a write-capable developer API, review-before-submit, changelog and bug-bounty links explicit. Its public job directory exposes keyword, location, seniority, workplace, employment type, recency and sponsorship filters; the public detail page exposes skills, pay, experience and an auto-apply handoff. These are recorded as distinct capabilities rather than inferred from the older PDF. IR35Careers adapts the mobile, messaging and disclosure information architecture through truthful `/mobile`, `/messaging` and `/bug-bounty` routes; native stores, message delivery, write-capable OAuth tools and ATS submission remain provider-gated.

IR35Careers now adapts the relevant workflow as an original UK contractor product:

- job discovery and explicit IR35 evidence;
- deterministic CV scoring and evidence gaps;
- role-grounded cover letter and reviewed application questions;
- approval-only dry-run receipt and external handoff;
- non-drag application tracker and linked recruiter inbox;
- contractor/company/work-authorisation profile;
- dry-run match/rate/status/workplace automation rules;
- billing, inbound mail and live submission held behind provider gates.
- installable PWA readiness, live browser install affordance and offline-recovery status;
- dedicated messaging readiness with production-derived connection state;
- standard responsible-disclosure discovery through `/.well-known/security.txt`.

It does not reproduce Tsenta branding, copy, screenshots, company logos, exact layout, pricing, proprietary automation, or claims of universal ATS coverage.

## Outside IR35 Tech Jobs

- **Source:** https://outsideir35.org.uk/
- **PDF:** named in page 1; no embedded page capture.
- **Journey:** filter immediately -> scan dense results -> inspect/unlock/apply -> set alert.
- **Hierarchy:** job utility dominates. Desktop uses a compact table; mobile/tablet stack filters and turn rows into cards. Persistent mobile actions expose edit filters and alerts.
- **Motion:** minimal; utility and freshness take priority.
- **Responsive:** the mobile conversion from table to readable cards is effective. The sticky action row is useful, but it occupies permanent vertical space and must account for safe areas.
- **Accessibility:** explicit text status and direct actions help. Dark low-contrast secondary text, small controls and dense desktop rows need improvement.
- **Performance:** compact and content-first. Large filter/result datasets still need request cancellation and incremental rendering.
- **Adapt:** status/rate/posted visibility, stacked mobile job cards, mobile filter sheet and persistent alert action after a search is configured.
- **Must not copy:** dark visual identity, unlock mechanics, exact table or wording.
- **IR35Careers interpretation:** calmer light surfaces, more breathing room, status provenance and accessible cards while preserving fast scanning.

## Reed contract jobs

- **Source:** https://www.reed.co.uk/jobs/contract-jobs
- **PDF:** cited as a desired job source on page 26.
- **Journey:** search what/where -> filter -> scan cards -> save/hide -> create alert.
- **Hierarchy:** familiar two-field search, filter rail, result count and repeated job cards.
- **Motion:** reversible hide feedback and filter/result updates are the useful patterns.
- **Responsive:** desktop filter rail becomes a mobile control. In all captured viewports the consent dialog dominates the task; at 390px it fills nearly the entire screen.
- **Accessibility:** familiar native controls help, but the consent experience has high cognitive load and many partners. IR35Careers should minimise tracking and offer a concise equal-weight choice.
- **Performance:** advertising, consent and third-party scripts increase page complexity.
- **Adapt:** undo after hiding a job, result count, search persistence and alert CTA.
- **Must not copy:** magenta brand, promoted-card treatment, consent wording, proprietary content or logos.
- **IR35Careers interpretation:** privacy-light acquisition, quieter cards and no advertising competition inside the core search task.

## Indeed UK IR35 results

- **Source:** https://uk.indeed.com/q-ir35-jobs.html
- **PDF:** cited as a desired source on page 26.
- **Journey:** keyword/location search -> result list -> job detail -> account gate or employer site.
- **Hierarchy:** title, company, location, pay/type and description fragments surface quickly.
- **Responsive:** a separate mobile result surface exists, but live interactive capture was not completed in this audit.
- **Accessibility/performance:** semantic search content is strong; duplicated listings, mixed permanent roles and account gates create friction for an IR35-specific audience.
- **Adapt:** robust salary/type parsing and mobile-first detail hierarchy.
- **Must not copy or automate:** proprietary results, logos, account gates or protected application flows. Use an authorised feed only.
- **IR35Careers interpretation:** stricter contract/IR35 relevance, transparent source links and fewer irrelevant results.

## Public ATS patterns: Greenhouse, Lever, Ashby, Workable and Workday

- **Source:** public employer-hosted job pages and public feed formats; existing repository adapters cover Greenhouse, Lever, Ashby and Workable. Workday was named in the PDF/Tsenta workflow but has no current adapter.
- **Journey:** job detail -> personal details -> resume -> screening questions -> voluntary demographic fields -> review/submit.
- **Useful pattern:** linear sections, autosave where supported, required-field clarity and a final review receipt.
- **Risk:** ATS forms vary per employer, change without notice, include bot controls and may require login. Untrusted job text or questions can also contain prompt-injection content.
- **Adapt:** build an internal application packet and dry-run adapter contract before any live automation.
- **Must not do:** bypass login, CAPTCHA or anti-bot controls; silently answer legal/demographic questions; submit without approval; claim universal ATS support.
- **IR35Careers interpretation:** a user-controlled preparation workspace with provider-specific capability labels and a “needs you” state for unsupported questions.

## Generic sidebar sample in PDF

- **Source:** pages 27-52 of the supplied PDF; generic React/Tailwind/Carbon example.
- **Problem solved:** collapsible two-level navigation for a very broad enterprise application.
- **Useful pattern:** persistent desktop rail, contextual second level and reversible collapse.
- **Weaknesses:** fixed 800px height, desktop-only composition, generic information architecture, 500ms routine transitions, non-button clickable divs and an overlapping Carbon icon dependency.
- **Adapt:** none for the public MVP beyond the concept of contextual navigation.
- **Must not copy:** code, generic sections, fixed dimensions, Carbon dependency or dark visual identity.
- **IR35Careers interpretation:** compact member navigation using the existing Lucide set, a labelled desktop sidebar/top bar, and a purpose-built mobile menu.

## Original design direction

IR35Careers combines the job immediacy of OutsideIR35, the transparent workflow evidence of Tsenta and the familiar search mechanics of UK job boards. Its distinct centre of gravity is IR35 clarity: status provenance, day-rate visibility, working arrangement, take-home tools and a review-first application workflow.
