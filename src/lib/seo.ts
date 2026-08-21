export const SITE_ORIGIN = "https://www.ir35careers.com";
export const SITE_NAME = "IR35Careers";

export function buildHomeStructuredData() {
  const organisationId = `${SITE_ORIGIN}/#organisation`;

  return [
    {
      "@context": "https://schema.org",
      "@type": "WebSite",
      "@id": `${SITE_ORIGIN}/#website`,
      url: `${SITE_ORIGIN}/`,
      name: SITE_NAME,
      alternateName: ["IR35 Careers", "ir35careers.com"],
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
      alternateName: "IR35 Careers",
      url: `${SITE_ORIGIN}/`,
      logo: {
        "@type": "ImageObject",
        url: `${SITE_ORIGIN}/images/generated/brand/ir35careers-app-icon-256.png`,
        width: 256,
        height: 256,
      },
      email: "ir35careers@gmail.com",
    },
  ];
}
