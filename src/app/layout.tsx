import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { headers } from "next/headers";
import "./globals.css";
import { CookieNotice } from "@/components/CookieNotice";
import { PwaRegister } from "@/components/PwaRegister";
import { FeedbackBubble } from "@/components/FeedbackBubble";
import { GoogleAnalytics } from "@/components/GoogleAnalytics";
import { AppMotion } from "@/components/AppMotion";
import { SITE_ORIGIN } from "@/lib/seo";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "IR35Careers | Find Better UK Contract Jobs",
    template: "%s | IR35Careers",
  },
  description:
    "Find UK contract roles with IR35 status, day rates and working arrangements up front. Search, compare, save and create contractor job alerts.",
  keywords: [
    "IR35",
    "UK contractor jobs",
    "Inside IR35",
    "Outside IR35",
    "contract jobs UK",
    "IT contractor",
    "freelance jobs UK",
    "IR35 careers",
  ],
  authors: [{ name: "IR35Careers" }],
  creator: "IR35Careers",
  publisher: "IR35Careers",
  metadataBase: new URL(SITE_ORIGIN),
  icons: {
    icon: [{ url: "/images/generated/brand/ir35careers-app-icon-256.png", sizes: "256x256", type: "image/png" }],
    apple: [{ url: "/apple-icon.png", sizes: "180x180", type: "image/png" }],
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: `${SITE_ORIGIN}/`,
    title: "IR35Careers | Find Better UK Contract Jobs",
    description:
      "Find UK contract roles with IR35 status, day rates and working arrangements up front.",
    siteName: "IR35Careers",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "IR35Careers | Find Better UK Contract Jobs",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "IR35Careers | Find Better UK Contract Jobs",
    description:
      "Find UK contract roles with IR35 status, day rates and working arrangements up front.",
    images: ["/og-image.png"],
    creator: "@ir35careers",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  return (
    <html lang="en-GB" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className={`${inter.variable} font-sans antialiased`}>
        <AppMotion>{children}</AppMotion>
        <GoogleAnalytics nonce={nonce} />
        <FeedbackBubble />
        <CookieNotice />
        <PwaRegister />
      </body>
    </html>
  );
}
