import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "AI and Automation Disclosure", description: "How IR35Careers uses deterministic scoring, optional AI tailoring, automation and human approval." };

const sections = [
  { id: "current", label: "What is used today" },
  { id: "scores", label: "CV and match scores" },
  { id: "automation", label: "Application automation" },
  { id: "provider", label: "Optional AI tailoring" },
  { id: "control", label: "Your control and reporting" },
];

export default function AiDisclosurePage() {
  return <LegalDocument eyebrow="Product transparency" title="AI and Automation Disclosure" summary="What IR35Careers calculates automatically, what it does not do, and where a contractor must remain in control." sections={sections}>
    <section aria-labelledby="current"><h2 id="current">What is used today</h2><p className="mt-3">The baseline role-match score, missing-keyword detection and recruiter-message classification use published deterministic rules. When the optional AI connection is enabled, a signed-in user may separately request evidence-grounded CV edits and a cover-letter draft. The interface labels that request and does not run it silently.</p><LegalCallout><strong>No automated score decides whether you receive an interview, engagement or other opportunity.</strong> Employers and recruiters make their own decisions independently of IR35Careers.</LegalCallout></section>
    <section aria-labelledby="scores"><h2 id="scores">CV and match scores</h2><p className="mt-3">CV Studio compares role terms with the text you provide, evidence-oriented wording, role relevance and ATS readability. The full weighted rubric appears beside the score. A missing term is never treated as experience, and it enters a version only after you confirm it is true.</p></section>
    <section aria-labelledby="automation"><h2 id="automation">Application automation</h2><p className="mt-3">After you approve the final application, the IR35Careers browser runner can open the employer portal, detect common application fields, upload the approved CV, enter saved facts and submit the form. With your permission, it can create or sign in to an employer account using your assigned IR35Careers email and use an ordinary email verification code sent to that address for the matching application. If the employer requires a visible CAPTCHA, declaration or unusual control, the optional IR35Careers Application Assistant can continue the same approved application in the employer tab you opened. It activates only for the short-lived application handoff started from your workspace, highlights the exact unresolved control and records Applied only after detecting employer confirmation. OpenRouter may be used to map an unfamiliar field label to the name of an existing saved fact. It does not receive the fact value for this mapping and cannot invent an answer. New legal or personal questions, CAPTCHA, multi-factor authentication and identity checks remain under your control.</p></section>
    <section aria-labelledby="provider"><h2 id="provider">Optional AI tailoring</h2><p className="mt-3">IR35Careers can use OpenRouter as an optional processor for a tailoring request you start. Before transmission, direct email addresses, phone numbers and common profile URLs are redacted. The request asks for zero-data-retention routing and denies providers that require data collection. The selected model provider may still process the remaining CV evidence and job description outside the UK under its own security and subprocessor terms.</p><ul className="mt-4"><li>Structured output and exact-source evidence checks reject unsupported edits.</li><li>New numbers are rejected unless the source evidence already contains them.</li><li>You choose each edit; an AI response never overwrites the source CV automatically.</li><li>If the provider fails or is unavailable, the original CV remains unchanged and the deterministic score still works.</li></ul></section>
    <section aria-labelledby="control"><h2 id="control">Your control and reporting</h2><ul className="mt-4"><li>Review, edit or reject every suggestion.</li><li>Keep version history and export only the version you approve.</li><li>Request an account-data export or delete your account in Settings.</li><li>Report a scoring, accuracy, safety or bias concern through <Link href="/contact">Contact</Link>.</li></ul></section>
  </LegalDocument>;
}
