import type { JobDetail } from "@/lib/job-types";
import { formatRate } from "@/lib/job-types";
import { publicPageMetadata, SITE_ORIGIN } from "@/lib/seo";

export function jobMetadata(job: JobDetail) {
  const status = job.ir35_status === "unknown" ? "IR35 status not stated" : `${job.ir35_status === "inside" ? "Inside" : "Outside"} IR35`;
  const rate = job.rate_min === null && job.rate_max === null ? "Rate not stated" : formatRate(job);
  const skills = job.skills.slice(0, 3).join(", ");
  // The role and advertiser distinguish pages, even where salary is undisclosed.
  const description = `${job.title} at ${job.company_name}, ${job.location || "UK"}. ${rate}; ${status}.${skills ? ` Skills: ${skills}.` : ""}`;
  const title = job.title.length < 36 ? `${job.title} – ${job.company_name}` : job.title;
  return publicPageMetadata(`/jobs/${job.id}`, title, description);
}

/** Only facts visible in the listing: no invented salary, expiry, employer URL or directApply promise. */
export function buildJobPosting(job: JobDetail) {
  if (job.source_domain === "demo.ir35careers.local" || !job.title.trim() || !job.description.trim() || !job.company_name.trim()) return null;
  // first_seen_at is discovery time, NOT the advertiser's original posting date.
  if (!job.posted_at || !Number.isFinite(Date.parse(job.posted_at))) return null;
  const location = job.location?.trim();
  if (!location) return null;
  const remote = job.remote_type === "remote";
  const unit = { daily: "DAY", hourly: "HOUR", annual: "YEAR", unknown: null }[job.rate_type];
  const hasSalary = unit && job.rate_currency && (job.rate_min !== null || job.rate_max !== null);
  const min = job.rate_min;
  const max = job.rate_max;
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    "@id": `${SITE_ORIGIN}/jobs/${job.id}#job`,
    url: `${SITE_ORIGIN}/jobs/${job.id}`,
    title: job.title,
    description: job.description.split(/\n{2,}/).map(paragraph => `<p>${paragraph.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p>`).join(""),
    datePosted: new Date(job.posted_at).toISOString(),
    employmentType: "CONTRACTOR",
    hiringOrganization: { "@type": "Organization", name: job.company_name },
    // The ingestion UK gate admits these listings to this UK-only board.
    ...(remote ? {
      jobLocationType: "TELECOMMUTE",
      applicantLocationRequirements: { "@type": "Country", name: "United Kingdom" },
    } : {
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressLocality: location, addressCountry: "GB" } },
    }),
    ...(hasSalary ? {
      baseSalary: {
        "@type": "MonetaryAmount", currency: job.rate_currency,
        value: { "@type": "QuantitativeValue", unitText: unit,
          ...(min !== null && max !== null && min === max ? { value: min } : {
            ...(min !== null ? { minValue: min } : {}), ...(max !== null ? { maxValue: max } : {}),
          }),
        },
      },
    } : {}),
    ...(job.skills.length ? { skills: job.skills.join(", ") } : {}),
  };
}
