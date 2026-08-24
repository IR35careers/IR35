import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Security and Responsible Disclosure", description: "IR35Careers security controls and responsible vulnerability-reporting rules." };
const sections = [
  { id: "controls", label: "Security controls" },
  { id: "report", label: "Report a vulnerability" },
  { id: "rules", label: "Safe testing rules" },
  { id: "response", label: "What happens next" },
];

export default function SecurityPage() {
  return <LegalDocument eyebrow="Trust centre" title="Security and Responsible Disclosure" summary="How IR35Careers protects contractor information and how to report a security concern without putting other users at risk." sections={sections}>
    <section aria-labelledby="controls"><h2 id="controls">Security controls</h2><ul className="mt-4"><li>Supabase authentication and owner-scoped row-level security protect account records.</li><li>Resume storage is private and separated by user identifier. PDF/DOCX signatures, archive expansion and active or embedded content are checked before a profile Resume is stored.</li><li>Replacement cleanup is owner-scoped and starts only after the new profile reference saves successfully; a failed profile save rolls the new upload back.</li><li>Server-only credentials are excluded from browser bundles.</li><li>Inbound webhooks require feature flags, signatures and idempotency identifiers.</li><li>Stripe test-mode events never grant production paid access.</li><li>New billing sales can be paused without disabling existing-customer cancellation, portal or account-deletion controls.</li><li>Live submission, email and billing providers default to off until their safety gates pass.</li></ul></section>
    <section aria-labelledby="report"><h2 id="report">Report a vulnerability</h2><p className="mt-3">Use <Link href="/contact">Contact</Link> and begin the message with “Security disclosure”. Include the affected URL, impact, safe reproduction steps and a contact address. Do not include credentials, other users&apos; personal information or active exploit payloads.</p><LegalCallout><strong>There is not currently a paid bug-bounty programme.</strong> Good-faith reports are still welcomed and will be triaged responsibly.</LegalCallout></section>
    <section aria-labelledby="rules"><h2 id="rules">Safe testing rules</h2><p className="mt-3">Do not access another person&apos;s account or data, cause service degradation, send spam, upload malware, perform denial-of-service testing, use social engineering, test third-party providers, or retain information encountered accidentally. Stop immediately if you encounter personal information.</p></section>
    <section aria-labelledby="response"><h2 id="response">What happens next</h2><p className="mt-3">We will acknowledge a reproducible report, assess severity, preserve relevant evidence and coordinate a proportionate fix. Public disclosure should wait until a fix is available and users are no longer exposed.</p></section>
  </LegalDocument>;
}
