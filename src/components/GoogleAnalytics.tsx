"use client";

import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

export const ANALYTICS_CONSENT_KEY = "ir35_analytics_consent_v1";
export const ANALYTICS_CONSENT_EVENT = "ir35-analytics-consent";

type AnalyticsConsent = "granted" | "denied" | null;

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

function storedConsent(): AnalyticsConsent {
  try {
    const value = window.localStorage.getItem(ANALYTICS_CONSENT_KEY);
    return value === "granted" || value === "denied" ? value : null;
  } catch {
    return null;
  }
}

export function GoogleAnalytics({ nonce }: { nonce?: string }) {
  const measurementId = process.env.NEXT_PUBLIC_GOOGLE_ANALYTICS_ID?.trim() ?? "";
  const pathname = usePathname();
  const [consent, setConsent] = useState<AnalyticsConsent>(null);
  const [ready, setReady] = useState(false);
  const isAdminHost = typeof window !== "undefined" && window.location.hostname === "admin.ir35careers.com";

  useEffect(() => {
    setConsent(storedConsent());
    const update = () => setConsent(storedConsent());
    window.addEventListener(ANALYTICS_CONSENT_EVENT, update);
    return () => window.removeEventListener(ANALYTICS_CONSENT_EVENT, update);
  }, []);

  useEffect(() => {
    if (!ready || consent !== "granted" || !window.gtag || isAdminHost) return;
    window.gtag("event", "page_view", {
      page_path: pathname,
      page_location: `${window.location.origin}${pathname}`,
      page_title: document.title,
    });
  }, [consent, isAdminHost, pathname, ready]);

  if (!measurementId || consent !== "granted" || isAdminHost) return null;

  return (
    <>
      <Script id="ir35-google-consent" nonce={nonce} strategy="afterInteractive">
        {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag('consent','default',{analytics_storage:'denied',ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied',wait_for_update:500});gtag('set','ads_data_redaction',true);gtag('set','url_passthrough',false);`}
      </Script>
      <Script
        id="ir35-google-analytics"
        nonce={nonce}
        src={`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`}
        strategy="afterInteractive"
        onLoad={() => {
          window.gtag?.("consent", "update", {
            analytics_storage: "granted",
            ad_storage: "denied",
            ad_user_data: "denied",
            ad_personalization: "denied",
          });
          window.gtag?.("config", measurementId, {
            send_page_view: false,
            allow_google_signals: false,
            allow_ad_personalization_signals: false,
            anonymize_ip: true,
            cookie_expires: 7_776_000,
            cookie_flags: "SameSite=Lax;Secure",
          });
          setReady(true);
        }}
      />
    </>
  );
}
