import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Accessibility Statement", description: "Accessibility approach, current support and contact route for IR35Careers." };

const sections = [
  { id: "commitment", label: "Our commitment" },
  { id: "support", label: "What the site supports" },
  { id: "limitations", label: "Known limitations" },
  { id: "feedback", label: "Feedback and alternatives" },
  { id: "testing", label: "Testing and review" },
] as const;

export default function AccessibilityPage() {
  return (
    <LegalDocument eyebrow="Legal & trust" title="Accessibility Statement" summary="IR35Careers is designed so contractors can search, understand and prepare for roles regardless of device or access need." sections={[...sections]}>
      <section aria-labelledby="commitment"><h2 id="commitment">Our commitment</h2><p className="mt-3">We aim to meet the Web Content Accessibility Guidelines (WCAG) 2.2 Level AA for the website and core contractor journeys. Accessibility is treated as an ongoing product requirement, not a one-off checklist.</p><LegalCallout>We want you to be able to zoom, use a keyboard, navigate by headings and landmarks, and understand status without relying on colour alone.</LegalCallout></section>
      <section aria-labelledby="support"><h2 id="support">What the site supports</h2><ul className="mt-4"><li>Responsive layouts for mobile, tablet and desktop.</li><li>Keyboard-visible focus, semantic headings, labelled controls and skip-friendly landmarks.</li><li>Text labels alongside IR35 and application-status colours.</li><li>Reduced-motion preferences and readable contrast.</li><li>Native form controls where they provide the most reliable assistive-technology support.</li></ul></section>
      <section aria-labelledby="limitations"><h2 id="limitations">Known limitations</h2><p className="mt-3">Original job listings open on third-party websites that we do not control. Uploaded Resume documents may contain inaccessible formatting, and exported documents should be reviewed before use. Very long job descriptions and dense application records can also require additional navigation.</p><p className="mt-3">We are continuing manual checks with screen readers, 200% and 400% zoom, forced-colour modes and different mobile input methods.</p></section>
      <section aria-labelledby="feedback"><h2 id="feedback">Feedback and alternative formats</h2><p className="mt-3">If something prevents you from using IR35Careers, tell us through <Link href="/contact">Contact</Link>. Describe the page, task, browser/device and assistive technology if you are comfortable doing so. You can also request an accessible alternative for our original guidance or support response.</p><p className="mt-3">We aim to acknowledge accessibility reports promptly and prioritise issues that block core journeys.</p></section>
      <section aria-labelledby="testing"><h2 id="testing">Testing and review</h2><p className="mt-3">The public journey is checked with automated accessibility tests during development. Automated testing cannot find every barrier, so it is supplemented by keyboard and responsive review. This statement will be updated as coverage and known issues change.</p></section>
    </LegalDocument>
  );
}
