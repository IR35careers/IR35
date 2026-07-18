import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "UK Contract Jobs — Inside & Outside IR35 | IR35Careers",
  description:
    "Search live UK contract roles with clear IR35 status and day rates. Filter by Outside IR35, Inside IR35, remote, and rate.",
};

export default function JobsLayout({ children }: { children: React.ReactNode }) {
  return children;
}
