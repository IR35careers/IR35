import { withPublicPageMetadata } from "@/lib/seo";

export const metadata = withPublicPageMetadata("/dashboard", {
  title: "Contractor Dashboard",
  description: "Manage your contractor profile, saved contracts and applications in your private IR35Careers dashboard.",
  robots: { index: false, follow: false, nocache: true },
});

export default function PageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
