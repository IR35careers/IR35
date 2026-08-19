import type { Metadata } from "next";
import { RecruiterInbox } from "@/components/workspace/RecruiterInbox";

export const metadata: Metadata = { title: "Recruiter inbox", robots: { index: false, follow: false } };

export default function InboxPage() {
  return <RecruiterInbox />;
}

