import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = {
  title: "Privacy Notice",
  description: "How IR35Careers collects, uses, stores and protects contractor personal information.",
};

const sections = [
  { id: "who-we-are", label: "Who we are" },
  { id: "data-we-use", label: "Information we use" },
  { id: "purposes", label: "Purposes and lawful bases" },
  { id: "cv-analysis", label: "CV analysis and scoring" },
  { id: "sharing", label: "Sharing and international transfers" },
  { id: "retention", label: "Retention and security" },
  { id: "rights", label: "Your rights" },
  { id: "contact", label: "Contact and complaints" },
] as const;

export default function PrivacyPage() {
  return (
    <LegalDocument
      eyebrow="Legal & trust"
      title="Privacy Notice"
      summary="This notice explains what personal information IR35Careers uses, why we use it, who receives it and the choices available to you under UK data-protection law."
      sections={[...sections]}
    >
      <section aria-labelledby="who-we-are">
        <h2 id="who-we-are">Who we are</h2>
        <p className="mt-3"><strong>IR35Careers</strong> is responsible for the personal information processed through this website and contractor workspace. In data-protection terms, IR35Careers acts as the controller for account, profile, CV, application-workspace and support information.</p>
        <p className="mt-3">You can contact us using the <Link href="/contact">contact form</Link>. Choose a privacy or data-rights enquiry and include the email address linked to your account so we can verify and respond securely.</p>
      </section>

      <section aria-labelledby="data-we-use">
        <h2 id="data-we-use">Information we use</h2>
        <ul className="mt-4">
          <li><strong>Account information:</strong> email address, authentication identifiers, sign-in events and account preferences.</li>
          <li><strong>Contractor profile information:</strong> skills, work preferences, availability and optional limited-company details you choose to provide.</li>
          <li><strong>CV and application-workspace information:</strong> uploaded CV text, edits, role-specific scores, approved versions, screening-answer drafts and application-tracking records.</li>
          <li><strong>Search and alert information:</strong> queries, filters, saved contracts and alert preferences.</li>
          <li><strong>Communications:</strong> enquiries, feedback and recruiter messages routed through enabled workspace features.</li>
          <li><strong>Technical and security information:</strong> device/browser information, IP-derived security signals, timestamps, error logs and essential storage identifiers.</li>
          <li><strong>Job listing information:</strong> role data obtained from employers, authorised feeds, job boards and public applicant-tracking-system endpoints. This normally concerns organisations and vacancies rather than site users.</li>
        </ul>
        <LegalCallout><strong>Please minimise sensitive data.</strong> Do not add health, equality-monitoring, criminal-record, national-insurance, passport, bank or other special-category/high-risk information to a CV unless it is genuinely necessary for your own application.</LegalCallout>
      </section>

      <section aria-labelledby="purposes">
        <h2 id="purposes">Purposes and lawful bases</h2>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[620px] border-separate border-spacing-0 text-left text-sm">
            <thead><tr><th className="border-b border-slate-200 px-3 py-3 font-bold">Purpose</th><th className="border-b border-slate-200 px-3 py-3 font-bold">Typical lawful basis</th></tr></thead>
            <tbody className="text-slate-600">
              <tr><td className="border-b border-slate-100 px-3 py-3">Create and secure your account; provide saved jobs, CV tools and workspace functions</td><td className="border-b border-slate-100 px-3 py-3">Performance of our contract with you</td></tr>
              <tr><td className="border-b border-slate-100 px-3 py-3">Operate, protect, debug and improve the service; prevent abuse; keep accurate source links</td><td className="border-b border-slate-100 px-3 py-3">Legitimate interests in running a safe, useful contractor platform</td></tr>
              <tr><td className="border-b border-slate-100 px-3 py-3">Respond to enquiries and data-rights requests</td><td className="border-b border-slate-100 px-3 py-3">Legitimate interests, contract steps or legal obligation, depending on the request</td></tr>
              <tr><td className="px-3 py-3">Send optional marketing or activate non-essential analytics if introduced</td><td className="px-3 py-3">Consent, which can be withdrawn</td></tr>
            </tbody>
          </table>
        </div>
        <p className="mt-4">Providing an email address and password is necessary to create an account. Other profile and CV fields are optional, but some workspace features cannot work without the information they analyse or save.</p>
      </section>

      <section aria-labelledby="cv-analysis">
        <h2 id="cv-analysis">CV analysis, scoring and automated processing</h2>
        <p className="mt-3">IR35Careers can compare CV text with a job description, calculate an advisory match score, identify missing terms and suggest truth-preserving edits. The score is based on role keywords, evidence strength, CV structure and clarity. Missing experience is not automatically added.</p>
        <ul className="mt-4">
          <li>The tool supports your own preparation; it does not decide whether you receive an interview or a job.</li>
          <li>No application is submitted and no suggestion is accepted without your action.</li>
          <li>You can review, reject and edit suggestions side by side and download the version you approve.</li>
          <li>You may ask us to explain the scoring approach or raise an accuracy or bias concern through the contact form.</li>
        </ul>
        <p className="mt-3">IR35Careers does not currently use solely automated processing to make decisions that produce legal or similarly significant effects about you.</p>
      </section>

      <section aria-labelledby="sharing">
        <h2 id="sharing">Sharing, processors and international transfers</h2>
        <p className="mt-3">We do not sell personal information. We disclose only what is needed to operate the service, meet legal obligations or act on your instructions.</p>
        <ul className="mt-4">
          <li><strong>Supabase:</strong> authentication, database and account-session services.</li>
          <li><strong>Vercel:</strong> website hosting, delivery, operational logs and security.</li>
          <li><strong>Authentication providers:</strong> for example Google, only when you choose that sign-in method.</li>
          <li><strong>Professional advisers, regulators or authorities:</strong> where reasonably necessary or legally required.</li>
          <li><strong>Original job websites:</strong> when you choose an Apply or source link, that independent website receives information from your visit under its own notice.</li>
        </ul>
        <p className="mt-3">Some providers may process information outside the UK. Where required, we rely on an adequacy regulation or appropriate contractual safeguards and provider security commitments. Contact us if you want information about safeguards relevant to your data.</p>
      </section>

      <section aria-labelledby="retention">
        <h2 id="retention">Retention and security</h2>
        <p className="mt-3">We keep personal information only for as long as it is needed for the purpose described, your active account, dispute handling, security and legal obligations. The criteria include account activity, whether you still use a workspace record, source freshness, the nature of an enquiry and applicable limitation periods. When information is no longer needed, it is deleted or anonymised; provider backups expire on their managed schedules.</p>
        <p className="mt-3">We use row-level access controls, authenticated sessions, encrypted transport, restricted administrative access and provider security controls. No internet service can guarantee absolute security, so please use a unique password and tell us promptly if you suspect account misuse.</p>
      </section>

      <section aria-labelledby="rights">
        <h2 id="rights">Your rights</h2>
        <p className="mt-3">Depending on the purpose and lawful basis, you may have rights to be informed, access your data, correct it, erase it, restrict processing, object, receive portable data and withdraw consent. You also have the right to object to direct marketing at any time.</p>
        <p className="mt-3">We may ask for proportionate information to verify identity before disclosing or changing account data. Rights are not absolute, and we will explain any lawful reason why a request cannot be completed in full.</p>
      </section>

      <section aria-labelledby="contact">
        <h2 id="contact">Contact and complaints</h2>
        <p className="mt-3">Submit a request through our <Link href="/contact">contact page</Link>. If you remain concerned, you can complain to the UK Information Commissioner&apos;s Office at <a href="https://ico.org.uk/make-a-complaint/" target="_blank" rel="noreferrer">ico.org.uk/make-a-complaint</a>.</p>
        <p className="mt-3">We may update this notice when the service, providers or law changes. Material changes will be highlighted in the product or at account entry.</p>
      </section>
    </LegalDocument>
  );
}
