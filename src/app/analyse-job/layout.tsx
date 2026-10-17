import { withPublicPageMetadata } from "@/lib/seo";

export const metadata = withPublicPageMetadata("/analyse-job", {
  title: "Contract Job Analyser & CV Tailoring",
  description: "Analyse a UK contract job, review IR35 evidence and tailor your CV to the role using your real skills and experience. Keep every suggested change reviewable.",
});

export default function PageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
