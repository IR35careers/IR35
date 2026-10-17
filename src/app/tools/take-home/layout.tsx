import { publicPageMetadata } from "@/lib/seo";

export const metadata = {
  ...publicPageMetadata("/tools/take-home", "Contractor Take-Home Pay Calculator UK", "Compare estimated take-home pay Inside and Outside IR35. Enter your day rate and working pattern to explore a detailed UK contractor tax breakdown."),
};

export default function PageLayout({ children }: { children: React.ReactNode }) {
  return children;
}
