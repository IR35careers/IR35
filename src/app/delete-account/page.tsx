import type { Metadata } from "next";
import Link from "next/link";
import { LegalCallout, LegalDocument } from "@/components/legal/LegalDocument";

export const metadata: Metadata = { title: "Delete your IR35Careers account", description: "How to export and permanently delete an IR35Careers account." };
const sections = [
  { id: "before", label: "Before deletion" },
  { id: "delete", label: "Delete the account" },
  { id: "removed", label: "What is removed" },
  { id: "help", label: "If you cannot sign in" },
];

export default function DeleteAccountPage() {
  return <LegalDocument eyebrow="Account control" title="Delete your account" summary="You can export your information and permanently delete your IR35Careers account without contacting support." sections={sections}>
    <section aria-labelledby="before"><h2 id="before">Before deletion</h2><p className="mt-3">Sign in and open <Link href="/settings">Settings</Link>. Download the portable account export first if you want a copy of your profile, saved roles, alerts, CV versions, application workspace, inbox and automation records.</p></section>
    <section aria-labelledby="delete"><h2 id="delete">Delete the account</h2><ol className="mt-4"><li>Open Settings and choose <strong>Delete account</strong>.</li><li>Enter the exact email address of the signed-in account.</li><li>Review the permanent-deletion warning and confirm.</li></ol><LegalCallout>Deletion cannot be undone. The request uses your signed-in session and an explicit typed confirmation; a normal cross-site request cannot trigger it.</LegalCallout></section>
    <section aria-labelledby="removed"><h2 id="removed">What is removed</h2><p className="mt-3">The authentication account is deleted together with owner-linked profile, saved-role, alert, CV-version, application, inbox and automation records. Private CV files are removed before the account is deleted. Public job listings and anonymised operational records are not personal account records and are not removed.</p></section>
    <section aria-labelledby="help"><h2 id="help">If you cannot sign in</h2><p className="mt-3">Use the password-reset option on the sign-in page. If you still cannot access the account, send a privacy request through <Link href="/contact">Contact</Link> using the account email so identity can be verified securely.</p></section>
  </LegalDocument>;
}
