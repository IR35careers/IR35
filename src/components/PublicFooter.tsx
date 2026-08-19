import Link from "next/link";
import { Brand } from "@/components/ui/brand";

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
      ["IR35 resources", "/resources"],
      ["Status checker", "/tools/ir35-status"],
      ["Take-home calculator", "/tools/take-home"],
    ],
  },
  {
    title: "IR35Careers",
    links: [
      ["Contractor workspace", "/dashboard"],
      ["Product updates", "/blog"],
      ["Contractor stories", "/stories"],
      ["Contact", "/contact"],
    ],
  },
] as const;

export function PublicFooter() {
  return (
    <footer className="border-t border-slate-200 bg-white">
      <div className="ir35-container grid gap-10 py-12 sm:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto] lg:gap-16">
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
                  <Link href={href} className="ir35-focus rounded text-sm text-slate-600 hover:text-brand-700">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-slate-100">
        <div className="ir35-container flex flex-col gap-2 py-5 text-xs text-slate-500 sm:flex-row sm:items-center sm:justify-between">
          <span>© {new Date().getFullYear()} IR35Careers</span>
          <span>Built for UK contractors.</span>
        </div>
      </div>
    </footer>
  );
}
