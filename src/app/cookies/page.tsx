import type { Metadata } from "next";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Cookie Policy", description: "Essential browser storage and cookie information for IR35Careers." };

const sections = [
  { id: "overview", label: "Our current approach" },
  { id: "storage", label: "Storage we use" },
  { id: "choices", label: "Your choices" },
  { id: "changes", label: "Future changes" },
] as const;

export default function CookiesPage() {
  return (
    <LegalDocument eyebrow="Legal & trust" title="Cookie Policy" summary="A clear explanation of the cookies, local storage and similar technologies used by IR35Careers." sections={[...sections]}>
      <section aria-labelledby="overview">
        <h2 id="overview">Our current approach</h2>
        <p className="mt-3">IR35Careers currently uses only browser storage that is necessary to provide secure sign-in, remember your privacy-notice choice and deliver workspace features you request. We do not currently use advertising cookies or non-essential analytics.</p>
        <LegalCallout><strong>No dark patterns:</strong> essential storage does not need an Accept All button. If non-essential analytics or advertising is introduced, it will stay off until you make a clear choice.</LegalCallout>
      </section>
      <section aria-labelledby="storage">
        <h2 id="storage">Storage we use</h2>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr><th className="border-b border-slate-200 p-3">Technology</th><th className="border-b border-slate-200 p-3">Purpose</th><th className="border-b border-slate-200 p-3">Duration</th></tr></thead><tbody className="text-slate-600"><tr><td className="border-b border-slate-100 p-3">Supabase authentication storage</td><td className="border-b border-slate-100 p-3">Keep you signed in securely and refresh an authenticated session</td><td className="border-b border-slate-100 p-3">Session/persistent according to your sign-in state; removed on sign-out or browser clearing</td></tr><tr><td className="border-b border-slate-100 p-3"><code>ir35_privacy_notice_ack_v1</code></td><td className="border-b border-slate-100 p-3">Remember that you have seen the essential-storage notice</td><td className="border-b border-slate-100 p-3">Until cleared or the notice version changes</td></tr><tr><td className="p-3">Workspace browser storage</td><td className="p-3">Keep drafts, preview data or approved versions on your device where the interface says data is local</td><td className="p-3">Until you delete it, clear site data or the feature replaces it with account storage</td></tr></tbody></table></div>
        <p className="mt-4">Security, load-balancing or hosting providers may use short-lived strictly necessary technologies to deliver and protect the site. Names and durations can change when providers update secure infrastructure.</p>
      </section>
      <section aria-labelledby="choices">
        <h2 id="choices">Your choices</h2>
        <p className="mt-3">You can clear or block browser storage in your browser settings. Blocking authentication storage will prevent sign-in and some workspace functions. Clearing local workspace storage may permanently remove drafts held only on that device.</p>
      </section>
      <section aria-labelledby="changes">
        <h2 id="changes">Future changes</h2>
        <p className="mt-3">Before enabling non-essential measurement, personalisation or advertising technologies, we will update this policy and provide an equal, understandable choice to accept or reject them. Continuing to browse will not be treated as consent.</p>
      </section>
    </LegalDocument>
  );
}
