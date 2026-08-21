import type { Metadata } from "next";
import { JobsWorkspaceShell } from "@/components/workspace/JobsWorkspaceShell";

export const metadata: Metadata = {
  title: "UK Contract Jobs: Inside & Outside IR35",
  description:
    "Search live UK contract roles with clear IR35 status and day rates. Filter by Outside IR35, Inside IR35, remote, and rate.",
  alternates: { canonical: "/jobs" },
  openGraph: {
    title: "UK Contract Jobs: Inside & Outside IR35",
    description: "Search live UK contract roles with clear IR35 status, day rates and working arrangements.",
    url: "/jobs",
  },
};

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return <JobsWorkspaceShell>{children}</JobsWorkspaceShell>;
}
