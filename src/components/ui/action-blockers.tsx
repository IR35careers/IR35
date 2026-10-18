import Link from "next/link";
import type { ActionBlocker } from "@/lib/workspace/action-blockers";

export function ActionBlockers({ id, title, blockers, onFocus }: {
  id: string;
  title: string;
  blockers: ActionBlocker[];
  onFocus: (targetId: string) => void;
}) {
  return <div id={id} aria-live="polite" aria-atomic="true">
    {blockers.length > 0 && <section aria-label={title} className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <h3 className="text-sm font-semibold">{title}</h3>
      <ul className="mt-2 space-y-2 text-sm leading-6">
        {blockers.map(blocker => <li key={blocker.id}>
          <p>{blocker.message}</p>
          {blocker.href && <Link href={blocker.href} className="ir35-focus inline-flex min-h-11 items-center font-semibold underline underline-offset-4">{blocker.actionLabel}</Link>}
          {blocker.targetId && <button type="button" onClick={() => onFocus(blocker.targetId!)} className="ir35-focus inline-flex min-h-11 items-center text-left font-semibold underline underline-offset-4">{blocker.actionLabel}</button>}
        </li>)}
      </ul>
    </section>}
  </div>;
}
