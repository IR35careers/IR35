import { publicPageMetadata } from "@/lib/seo";

export const metadata = {
  ...publicPageMetadata("/tools/ir35-status", "IR35 Status Checker for UK Contractors", "Check the IR35 status indicators of a UK contract. Review working practices, understand Inside and Outside IR35 factors and see where more evidence is needed."),
};

export default function PageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
