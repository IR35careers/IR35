export const SITE_ORIGIN = "https://www.ir35careers.com";
export const SITE_NAME = "IR35Careers";
export const SITE_DESCRIPTION =
  "IR35Careers is a UK contractor job platform for finding Inside and Outside IR35 contracts, preparing role-specific Resumes and tracking applications.";
export const SOCIAL_PROFILES = ["https://www.instagram.com/ir35careers/"] as const;

export function buildHomeStructuredData() {
  const organisationId = `${SITE_ORIGIN}/#organisation`;
  const websiteId = `${SITE_ORIGIN}/#website`;
  const logoUrl = `${SITE_ORIGIN}/images/generated/brand/ir35careers-app-icon-512.png`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": websiteId,
      url: `${SITE_ORIGIN}/`,
      name: SITE_NAME,
      alternateName: ["IR35 Careers", "ir35careers.com"],
      description: SITE_DESCRIPTION,
      inLanguage: "en-GB",
      publisher: { "@id": organisationId },
      potentialAction: {
        "@type": "SearchAction",
        target: {
          "@type": "EntryPoint",
          urlTemplate: `${SITE_ORIGIN}/jobs?q={search_term_string}`,
        },
        "query-input": "required name=search_term_string",
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "Organization",
      "@id": organisationId,
      name: SITE_NAME,
      alternateName: ["IR35 Careers", "ir35careers.com"],
      url: `${SITE_ORIGIN}/`,
      description: SITE_DESCRIPTION,
      logo: {
        "@type": "ImageObject",
        "@id": `${SITE_ORIGIN}/#logo`,
        url: logoUrl,
        contentUrl: logoUrl,
        width: 512,
        height: 512,
        caption: SITE_NAME,
      },
      image: { "@id": `${SITE_ORIGIN}/#logo` },
      email: "ir35careers@gmail.com",
      sameAs: [...SOCIAL_PROFILES],
      contactPoint: {
        "@type": "ContactPoint",
        contactType: "customer support",
        email: "ir35careers@gmail.com",
        url: `${SITE_ORIGIN}/contact`,
        areaServed: "GB",
        availableLanguage: ["en-GB"],
      },
    },
    {
      "@context": "https://schema.org",
      "@type": "WebPage",
      "@id": `${SITE_ORIGIN}/#webpage`,
      url: `${SITE_ORIGIN}/`,
      name: "IR35Careers: UK Contract Jobs and IR35 Tools",
      description: SITE_DESCRIPTION,
      isPartOf: { "@id": websiteId },
      about: { "@id": organisationId },
      primaryImageOfPage: { "@id": `${SITE_ORIGIN}/#logo` },
      inLanguage: "en-GB",
    },
  ];
}
