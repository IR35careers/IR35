import type { Metadata } from "next";
import { AuthCallback } from "@/components/ui/auth-callback";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: { absolute: "Secure sign-in | IR35Careers" },
  robots: { index: false, follow: false },
  alternates: { canonical: "https://www.ir35careers.com/auth/callback" },
  referrer: "no-referrer",
};

export default function AuthCallbackPage() { return <AuthCallback />; }
