import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "AI and Automation Disclosure", description: "How IR35Careers uses deterministic scoring, automation and human approval." };

const sections = [
  { id: "current", label: "What is used today" },
  { id: "scores", label: "CV and match scores" },
  { id: "automation", label: "Application automation" },
  { id: "future", label: "Future AI providers" },
  { id: "control", label: "Your control and reporting" },
];

export default function AiDisclosurePage() {
  return <LegalDocument eyebrow="Product transparency" title="AI and Automation Disclosure" summary="What IR35Careers calculates automatically, what it does not do, and where a contractor must remain in control." sections={sections}>
    <section aria-labelledby="current"><h2 id="current">What is used today</h2><p className="mt-3">Role matching, CV scoring, missing-keyword detection, conservative wording suggestions and recruiter-message classification currently use published deterministic rules. They do not call a generative-AI provider.</p><LegalCallout><strong>No automated score decides whether you receive an interview, engagement or other opportunity.</strong> Employers and recruiters make their own decisions independently of IR35Careers.</LegalCallout></section>
    <section aria-labelledby="scores"><h2 id="scores">CV and match scores</h2><p className="mt-3">CV Studio compares role terms with the text you provide, evidence-oriented wording, role relevance and ATS readability. The full weighted rubric appears beside the score. A missing term is never treated as experience, and it enters a version only after you confirm it is true.</p></section>
    <section aria-labelledby="automation"><h2 id="automation">Application automation</h2><p className="mt-3">The application workflow prepares materials and can submit an approved packet only through a verified employer or ATS connection. It cannot silently submit a live application. CV changes, cover letters, screening answers and the destination all require human review. Unsupported, legal, demographic, CAPTCHA and account-login questions remain in a “needs you” state.</p></section>
    <section aria-labelledby="future"><h2 id="future">Future AI providers</h2><p className="mt-3">A future optional AI provider remains disabled until structured output, truth-preserving grounding, prompt-injection defence, data minimisation, redaction, retention, cost controls, provider terms and failure fallbacks have been tested. Provider-backed content will be labelled and will not bypass approval.</p></section>
    <section aria-labelledby="control"><h2 id="control">Your control and reporting</h2><ul className="mt-4"><li>Review, edit or reject every suggestion.</li><li>Keep version history and export only the version you approve.</li><li>Request an account-data export or delete your account in Settings.</li><li>Report a scoring, accuracy, safety or bias concern through <Link href="/contact">Contact</Link>.</li></ul></section>
  </LegalDocument>;
}
