# IR35Careers experience direction

**Audience:** IR35Careers product, design and engineering team  
**Date:** 26 August 2026  
**Scope:** Public landing experience, contractor conversion journey and application-control model  
**Assumptions:** IR35Careers remains a UK contractor product, uses only substantiated product claims and does not imply that an IR35 label is a legal determination.

## Executive answer

IR35Careers should not imitate a generic AI job-application site. Its strongest position is a contractor-specific workspace that makes status evidence, day rate, working pattern, reusable application facts and employer outcomes visible in one journey. The redesigned experience should borrow proven interaction patterns such as a single outcome-led hero, a reusable profile, clear application modes and a transparent tracker, while making the content unmistakably specific to UK contract work.

The immediate design direction is therefore:

1. Lead with one outcome: find, prepare and track UK contracts in one place.
2. Demonstrate the product with real Inside and Outside IR35 inventory, source identities and product previews, not invented customer logos or totals.
3. Explain the workflow as Prepare, Apply and Progress.
4. Present Automatic, Guided and Review as explicit user controls.
5. Keep employer security gates visible and never imply that login, CAPTCHA or identity checks are bypassed.
6. Replace a flat sequence of generic cards with a compact product story, live proof, contractor workflow, supporting tools and a decisive final action.

## Research analysis

### Reference recording analysis

The supplied 50-second recording presents one continuous commercial story rather than a stack of unrelated feature cards. Its strongest patterns are:

- a short outcome-led hero with high contrast and very little explanatory copy;
- an early source or company identity rail that creates momentum;
- large, colourful product-preview panels showing the workflow rather than merely describing it;
- a sequence that moves from finding work, to preparing materials, to submitting and tracking outcomes;
- alternating gradients, browser frames and dashboard fragments that keep the next idea visible while scrolling.

IR35Careers adapts that structure without copying the reference brand. The implementation uses the existing emerald, teal and navy identity; real contract inventory; source-system names with a no-endorsement notice; company monograms where licensed logos are unavailable; and product states that match the current application workflow.

### What the AI-application category does well

AIApply currently positions its product around finding matching jobs, tailoring application documents and submitting applications. Its public materials group the experience into preparation, application and outcome stages. Its help centre describes three application modes, profile-driven matching, an answer library, duplicate prevention and background application processing with dashboard tracking. These patterns reduce repeated form filling and give users a choice between automation and review.

Sources:

- [AIApply homepage](https://aiapply.co/)
- [How Auto Apply works](https://support.aiapply.co/en/articles/15692576-how-auto-apply-works)
- [How does Auto Apply work?](https://support.aiapply.co/en/articles/14216708-how-does-auto-apply-work)
- [Auto Apply settings](https://support.aiapply.co/en/articles/14218613-auto-apply-settings-setting-up-your-profile-and-job-preferences)

Tsenta's public workflow reinforces the same product-proof pattern: create a reusable profile, monitor compatible sources, tailor a role-specific Resume, submit supported forms, retain the receipt and connect later replies to the tracker. These are useful experience patterns, not evidence that every employer system can be automated.

Sources:

- [Tsenta Auto Apply](https://tsenta.com/auto-apply)
- [Tsenta homepage](https://tsenta.com/)
- [Tsenta contractor articles](https://tsenta.com/blog)

### What must be different for UK contractors

The off-payroll working rules apply engagement by engagement. In many cases the client determines status and should provide a Status Determination Statement with reasons. HMRC's CEST service considers the facts of the engagement, including the contract and working practices. This means a job advert label is useful evidence, but it is not a guarantee of the final tax treatment.

Sources:

- [Understanding off-payroll working](https://www.gov.uk/guidance/understanding-off-payroll-working-ir35)
- [Check employment status for tax](https://www.gov.uk/guidance/check-employment-status-for-tax)
- [Fee-payer responsibilities](https://www.gov.uk/guidance/fee-payer-responsibilities-under-the-off-payroll-working-rules)

### Pattern adaptation matrix

| Category pattern | Why it works | IR35Careers adaptation | Current decision |
| --- | --- | --- | --- |
| Outcome-led hero | Explains value before features | Search, tailor and track UK contracts in one workspace | Implement |
| Reusable applicant profile | Removes repeated form entry | Store approved contractor facts, availability, clearance, company details and application answers | Implement |
| Application modes | Gives users control over automation | Automatic, Guided and Review modes with visible safety gates | Implement |
| Tailored documents | Improves relevance | Evidence-preserving resume tailoring for each contract | Implement |
| Background processing | Saves time | Continue compatible employer forms and pause at genuine security or identity steps | Implement with explicit limits |
| Application tracker | Reduces uncertainty | Link preparation, employer confirmation and recruiter messages to the contract | Implement |
| Large testimonial wall | Creates social proof | Use only verified testimonials when IR35Careers has permission | Do not fabricate |
| Customer-logo marquee | Signals market adoption | Identify public listing sources and ATS technology, with an explicit no-endorsement notice | Adapt carefully |
| Universal success claim | Simplifies marketing | Report only supported employer forms and confirmed submissions | Reject |

## Experience architecture

The public page should read as one continuous product narrative:

1. **Promise:** contract search and application work in one workspace.
2. **Source context:** a pausable source rail that explains where public listings originate.
3. **Live proof:** current Inside and Outside IR35 contracts with company identity.
4. **Product demonstration:** role match, Resume preparation and tracked outcome.
5. **Workflow:** Discover, Prepare and Track.
6. **Controls:** Automatic, Guided and Review modes.
7. **Supporting confidence:** tools, guidance and plain-language FAQs.
8. **Conversion:** browse contracts or create a free account.

## Visual direction

- Preserve the IR35Careers emerald identity and use one controlled emerald-to-cyan gradient as the expressive accent.
- Use near-white surfaces, navy text, thin cool borders and large but disciplined rounded panels.
- Keep section spacing compact enough that the next idea is always visible at the fold.
- Use motion only for hierarchy: reveal, progress, a pausable source rail and hover depth. Respect reduced-motion preferences. The source rail stops automatically when reduced motion is requested and provides a visible Pause control, following [WCAG guidance for moving content](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide.html).
- Use a floating capsule header on the public home page and retain the existing product navigation elsewhere.
- Use a mobile sticky action only after the primary hero action leaves the viewport.

## Limitations

- Public competitors do not disclose the full technical implementation of their submission systems. Workflow descriptions are based on their public product and help materials.
- Testimonials, conversion rates, customer counts and employer logos must remain absent until IR35Careers has verifiable permission and evidence.
- Advertised IR35 status is evidence from a listing, not professional tax advice or a final status determination.

## Recommendations

1. Launch the redesigned public page with real contract inventory as the primary proof mechanism.
2. Standardise the words Resume, contract, employer confirmation and Needs you across product and marketing surfaces.
3. Track hero search, primary account creation, mode selection and application confirmation as the first conversion funnel.
4. Add verified customer stories later, using named consent, role context and a traceable outcome.
5. Review the claim ledger before every public release.

## Claim ledger

| Claim | Evidence | Public use |
| --- | --- | --- |
| IR35Careers lists current Inside and Outside IR35 contracts | Live database query in the featured jobs component | Allowed with current count only |
| Users can choose Automatic, Guided or Review | Product implementation and settings | Allowed |
| Resume tailoring preserves user evidence | Product workflow and approval model | Allowed |
| Every employer form can be submitted automatically | Not supportable because employers may require login, CAPTCHA or identity checks | Prohibited |
| An advertised Outside IR35 label guarantees status | Contradicted by HMRC contract-by-contract guidance | Prohibited |
| IR35Careers has a specific customer total or success rate | No verified dataset supplied | Prohibited |
