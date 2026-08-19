import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";
import { Toaster } from "react-hot-toast";

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
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_SITE_URL || "https://ir35careers.com"
  ),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "en_GB",
    url: "/",
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-GB" suppressHydrationWarning data-scroll-behavior="smooth">
      <body className={`${inter.variable} font-sans antialiased`}>
        <AuthProvider>{children}</AuthProvider>
        <Toaster
          position="bottom-right"
          toastOptions={{
            duration: 4000,
            style: {
              borderRadius: "1rem",
              padding: "1rem 1.25rem",
              fontSize: "0.9rem",
              fontWeight: 500,
            },
            success: {
              style: {
                background: "#f0fdf4",
                color: "#166534",
                border: "1px solid #bbf7d0",
              },
            },
            error: {
              style: {
                background: "#fef2f2",
                color: "#991b1b",
                border: "1px solid #fecaca",
              },
            },
          }}
        />
      </body>
    </html>
  );
}
