import Link from "next/link";
import { Brand } from "@/components/ui/brand";
import { legalOperatorConfig } from "@/lib/legal/operator";

const GROUPS = [
  {
    title: "Find work",
    links: [
      ["Browse contracts", "/jobs"],
      ["Feed health", "/jobs/sources"],
      ["Analyse external role", "/analyse-job"],
      ["Outside IR35", "/jobs?ir35=outside"],
      ["Remote contracts", "/jobs?remote=remote"],
    ],
  },
  {
    title: "Understand IR35",
    links: [
      ["IR35 resources", "/resources"],
      ["Status checker", "/tools/ir35-status"],
      ["Take-home calculator", "/tools/take-home"],
      ["Contractor research", "/research"],
    ],
  },
  {
    title: "IR35Careers",
    links: [
      ["Contractor workspace", "/dashboard"],
      ["Application analytics", "/analytics"],
      ["Platforms", "/platforms"],
      ["Mobile app", "/mobile"],
      ["Messaging", "/messaging"],
      ["Pricing", "/pricing"],
      ["Product updates", "/blog"],
      ["Changelog", "/changelog"],
      ["Contractor stories", "/stories"],
      ["Contact", "/contact"],
    ],
  },
  {
    title: "Legal & trust",
    links: [
      ["Privacy notice", "/privacy"],
      ["Cookie policy", "/cookies"],
      ["Billing & refunds", "/billing-policy"],
      ["Terms of use", "/terms"],
      ["Accessibility", "/accessibility"],
      ["AI disclosure", "/ai-disclosure"],
      ["Security", "/security"],
      ["Report a security issue", "/bug-bounty"],
      ["Job listing policy", "/job-listing-policy"],
      ["Delete account", "/delete-account"],
    ],
  },
] as const;

export function PublicFooter() {
  const operator = legalOperatorConfig();
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="ir35-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1.2fr_repeat(4,minmax(0,auto))] lg:gap-10 xl:gap-14">
        <div className="max-w-sm">
          <Brand />
          <p className="mt-3 text-sm leading-6 text-slate-600">
            UK contract discovery with IR35 status, rates and working arrangements up front.
          </p>
          <p className="mt-3 text-xs leading-5 text-slate-500">
            Educational information only. IR35 status depends on the facts of each engagement.
          </p>
        </div>
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h2 className="text-sm font-semibold text-slate-950">{group.title}</h2>
            <ul className="mt-3 space-y-2.5">
              {group.links.map(([label, href]) => (
                <li key={href}>
                  <Link href={href} prefetch={false} className="ir35-focus rounded text-sm text-slate-600 hover:text-brand-700">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100">
        <div className="ir35-container flex flex-col gap-3 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} IR35Careers · Built for UK contractors.{operator && <><br />Operated by {operator.legalName}{operator.companyNumber ? ` · Company ${operator.companyNumber}` : ""}{operator.vatNumber ? ` · VAT ${operator.vatNumber}` : ""}</>}</span>
          <span className="max-w-2xl sm:text-right">Job and IR35 information is educational, may be supplied by third parties and should be independently checked before you act.</span>
        </div>
      </div>
    </footer>
  );
}
