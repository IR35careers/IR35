import Link from "next/link";
import { Instagram } from "lucide-react";
import { Brand } from "@/components/ui/brand";
import { legalOperatorConfig } from "@/lib/legal/operator";

const GROUPS = [
  {
    title: "Find work",
    links: [
      ["Browse contracts", "/jobs"],
      ["Outside IR35", "/jobs?ir35=outside"],
      ["Remote contracts", "/jobs?remote=remote"],
    ],
  },
  {
    title: "Understand IR35",
    links: [
      ["IR35 careers guide", "/ir35-careers"],
      ["IR35 guides", "/resources"],
      ["What IR35 means", "/resources#what-is-ir35"],
      ["Inside and outside", "/resources#inside-outside"],
      ["How status is decided", "/resources#status-decision"],
    ],
  },
  {
    title: "IR35Careers",
    links: [
      ["About IR35Careers", "/about"],
      ["Contractor workspace", "/dashboard"],
      ["Contractor tools", "/tools"],
      ["Public beta", "/beta"],
      ["For employers", "/employers"],
      ["Pricing", "/pricing"],
      ["Product updates", "/blog"],
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
      ["Security", "/security"],
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
          <a
            href="https://www.instagram.com/ir35careers/"
            target="_blank"
            rel="noreferrer"
            className="ir35-focus mt-4 inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-600 transition-colors hover:border-brand-200 hover:bg-brand-50 hover:text-brand-800"
            aria-label="IR35Careers on Instagram"
          >
            <Instagram size={16} aria-hidden="true" /> Instagram
          </a>
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
          <span>© {new Date().getFullYear()} IR35Careers · Public beta · Built for UK contractors.{operator && <><br />Operated by {operator.legalName}{operator.companyNumber ? ` · Company ${operator.companyNumber}` : ""}{operator.vatNumber ? ` · VAT ${operator.vatNumber}` : ""}</>}</span>
          <span className="max-w-2xl sm:text-right">Job and IR35 information is educational, may be supplied by third parties and should be independently checked before you act.</span>
        </div>
      </div>
    </footer>
  );
}
