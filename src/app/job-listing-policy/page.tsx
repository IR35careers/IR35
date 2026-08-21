import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Job Listing and IR35 Information Policy", description: "How IR35Careers sources, refreshes, deduplicates and labels contract jobs." };

const sections = [
  { id: "sources", label: "Sources and provenance" },
  { id: "quality", label: "Quality and freshness" },
  { id: "classification", label: "IR35 classification" },
  { id: "rates", label: "Rates, skills and workplace" },
  { id: "apply", label: "Applications and reporting" },
] as const;

export default function JobListingPolicyPage() {
  return (
    <LegalDocument eyebrow="Transparency" title="Job Listing and IR35 Information Policy" summary="How contract opportunities are sourced, cleaned and labelled, and what you should verify before applying." sections={[...sections]}>
      <section aria-labelledby="sources"><h2 id="sources">Sources and provenance</h2><p className="mt-3">IR35Careers obtains vacancy information from employer applicant-tracking systems, authorised job-board APIs and contract-search providers. We keep a source identifier and original application link so the advertiser&apos;s page remains the final reference.</p><p className="mt-3">We do not bypass authentication, CAPTCHAs, paywalls or provider access controls. A listing on IR35Careers is not an endorsement of the advertiser.</p></section>
      <section aria-labelledby="quality"><h2 id="quality">Quality, deduplication and freshness</h2><ul className="mt-4"><li>Contract and UK-location gates remove clearly irrelevant permanent or non-UK roles.</li><li>Source identifiers prevent repeated imports; a secondary similarity check reduces cross-source duplicates.</li><li>Successful fetches refresh a last-seen time. Listings not seen for the configured stale period are removed from public results.</li><li>Search can still contain withdrawn, changed or mislabelled roles between source updates. Always check the original page.</li></ul><p className="mt-3">The Jobs page shows when the search response was refreshed and distinguishes stated facts from information that is unavailable.</p></section>
      <section aria-labelledby="classification"><h2 id="classification">IR35 classification</h2><LegalCallout><strong>“Outside”, “Inside” and “TBC” are evidence labels, not legal determinations.</strong> High confidence means explicit status wording appears in the title. Medium means explicit wording appears in the listing, or an umbrella/PAYE-only arrangement creates an Inside IR35 signal. TBC means no reliable status was found or the wording conflicts.</LegalCallout><p className="mt-3">Every contract-detail page distinguishes advertiser-stated wording from an arrangement-derived signal or a stored source/review label that cannot be reproduced from the current text. It also shows the matching phrase where available and the latest source-evidence date.</p><p className="mt-3">We do not infer Outside IR35 merely from words such as contract, limited company or day rate. The end client is responsible for a status determination where the off-payroll rules require one, and actual working practices remain important.</p></section>
      <section aria-labelledby="rates"><h2 id="rates">Rates, skills and workplace</h2><p className="mt-3">Rates are parsed from the source text and displayed using the most plausible unit, such as daily, hourly or annual. Implausible values are withheld or reclassified rather than presented as fact. Skills and remote/hybrid/on-site labels are extracted and normalised for comparison; they may not capture every requirement or attendance detail.</p></section>
      <section aria-labelledby="apply"><h2 id="apply">Applications, corrections and removals</h2><p className="mt-3">Applications start inside IR35Careers. A reviewed packet is submitted only after your explicit action and only through a verified employer or ATS connection. Unsupported destinations remain queued and are never presented as submitted; a preparation receipt is not an employer receipt.</p><p className="mt-3">Use <Link href="/contact">Contact</Link> to report an expired role, incorrect status/rate, duplicate, unsafe destination or rights concern. Include the IR35Careers URL and a short explanation so it can be reviewed efficiently.</p></section>
    </LegalDocument>
  );
}
