import type { Metadata } from "next";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";
import { CookiePreferencesButton } from "@/components/CookiePreferencesButton";

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
        <p className="mt-3">IR35Careers uses essential browser storage for secure sign-in and workspace features. With your separate permission, Google Analytics also measures aggregated visits, popular pages, traffic sources, device categories and approximate country, region and city. Analytics stays off until you actively allow it.</p>
        <LegalCallout><strong>Your choice is respected:</strong> choosing Essential only is as easy as allowing analytics. We do not use advertising cookies, Google advertising signals or personalised-advertising features.</LegalCallout>
      </section>
      <section aria-labelledby="storage">
        <h2 id="storage">Storage we use</h2>
        <div className="mt-4 overflow-x-auto"><table className="w-full min-w-[620px] text-left text-sm"><thead><tr><th className="border-b border-slate-200 p-3">Technology</th><th className="border-b border-slate-200 p-3">Purpose</th><th className="border-b border-slate-200 p-3">Duration</th></tr></thead><tbody className="text-slate-600"><tr><td className="border-b border-slate-100 p-3">Supabase authentication storage</td><td className="border-b border-slate-100 p-3">Keep you signed in securely and refresh an authenticated session</td><td className="border-b border-slate-100 p-3">Session/persistent according to your sign-in state; removed on sign-out or browser clearing</td></tr><tr><td className="border-b border-slate-100 p-3"><code>ir35_analytics_consent_v1</code></td><td className="border-b border-slate-100 p-3">Remember whether you allowed or declined optional analytics</td><td className="border-b border-slate-100 p-3">Until cleared or the choice version changes</td></tr><tr><td className="border-b border-slate-100 p-3">Google Analytics cookies, including <code>_ga</code></td><td className="border-b border-slate-100 p-3">Measure consented visits, sessions, page use, traffic source, device category and approximate location. No advertising signals are enabled.</td><td className="border-b border-slate-100 p-3">Up to 90 days in our configuration, or sooner if you withdraw consent or clear site data</td></tr><tr><td className="border-b border-slate-100 p-3">Workspace browser storage</td><td className="border-b border-slate-100 p-3">Keep drafts, preview data or approved versions on your device where the interface says data is local</td><td className="border-b border-slate-100 p-3">Until you delete it, clear site data or the feature replaces it with account storage</td></tr><tr><td className="p-3">Installable-app cache</td><td className="p-3">Keep a small set of public interface files and an offline recovery page available after a connection loss</td><td className="p-3">Until the app cache is updated or you clear this site&apos;s stored data</td></tr></tbody></table></div>
        <p className="mt-4">Security, load-balancing or hosting providers may use short-lived strictly necessary technologies to deliver and protect the site. Names and durations can change when providers update secure infrastructure.</p>
      </section>
      <section aria-labelledby="choices">
        <h2 id="choices">Your choices</h2>
        <p className="mt-3">You can allow or decline analytics without affecting sign-in, job search or workspace features. You can also change your choice at any time. Withdrawing consent stops future analytics collection; clearing site data removes Analytics cookies already stored on your device.</p>
        <CookiePreferencesButton />
      </section>
      <section aria-labelledby="changes">
        <h2 id="changes">Future changes</h2>
        <p className="mt-3">If our measurement purposes or providers materially change, we will update this policy and request a fresh choice where required. Continuing to browse is not treated as consent.</p>
      </section>
    </LegalDocument>
  );
}
