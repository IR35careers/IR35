import type { JobDetail } from "@/lib/job-types";

const DEMO_CLOCK = Date.now();
const hoursAgo = (hours: number) => new Date(DEMO_CLOCK - hours * 3_600_000).toISOString();

/**
 * Production-shaped local fixtures. They are returned only in development
 * when Supabase is not configured, and every consuming screen labels them as
 * preview data. Production never falls back to these records.
 */
export const DEMO_JOBS: JobDetail[] = [
  {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Senior DevOps Engineer - Outside IR35",
    company_name: "Northstar Digital",
    location: "London",
    remote_type: "hybrid",
    ir35_status: "outside",
    ir35_confidence: "high",
    rate_min: 600,
    rate_max: 675,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: ["AWS", "Terraform", "Kubernetes", "DevOps"],
    posted_at: hoursAgo(3),
    first_seen_at: hoursAgo(2.9),
    description:
      "Six-month Outside IR35 contract for a senior DevOps engineer. Visa sponsorship is available for this engagement. You will improve AWS platform reliability, Terraform modules and Kubernetes delivery workflows. Hybrid working in London two days per week.",
    apply_url: "https://example.com/jobs/devops",
    source_domain: "demo.ir35careers.local",
  },
  {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Data Migration Lead",
    company_name: "Civic Systems",
    location: "United Kingdom",
    remote_type: "remote",
    ir35_status: "inside",
    ir35_confidence: "medium",
    rate_min: 550,
    rate_max: 600,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: ["Data Engineering", "SQL", "Azure", "Stakeholder Management"],
    posted_at: hoursAgo(27),
    first_seen_at: hoursAgo(26.75),
    description:
      "Inside IR35 engagement leading a complex Azure data migration. Remote within the UK with occasional stakeholder workshops.",
    apply_url: "https://example.com/jobs/data-migration",
    source_domain: "demo.ir35careers.local",
  },
  {
    id: "33333333-3333-4333-8333-333333333333",
    title: "ServiceNow Technical Consultant",
    company_name: "Harbour Change",
    location: "Manchester",
    remote_type: "hybrid",
    ir35_status: "unknown",
    ir35_confidence: "low",
    rate_min: 500,
    rate_max: 550,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: ["ServiceNow", "Change Management", "Stakeholder Management"],
    posted_at: hoursAgo(31),
    first_seen_at: hoursAgo(30.8),
    description:
      "Initial six-month contract supporting ServiceNow implementation and stakeholder adoption. The listing does not state an IR35 determination.",
    apply_url: "https://example.com/jobs/servicenow",
    source_domain: "demo.ir35careers.local",
  },
  {
    id: "44444444-4444-4444-8444-444444444444",
    title: "SC Cleared Delivery Manager - Outside IR35",
    company_name: "Public Digital Partners",
    location: "Bristol",
    remote_type: "hybrid",
    ir35_status: "outside",
    ir35_confidence: "high",
    rate_min: 650,
    rate_max: 700,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: ["Delivery Manager", "Agile", "SC Cleared", "Stakeholder Management"],
    posted_at: hoursAgo(51),
    first_seen_at: hoursAgo(50.8),
    description:
      "Outside IR35 delivery leadership contract for a public-sector digital programme. Active SC clearance and weekly Bristol attendance required.",
    apply_url: "https://example.com/jobs/delivery",
    source_domain: "demo.ir35careers.local",
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    title: "Senior React Engineer",
    company_name: "Fieldwork Labs",
    location: "Leeds",
    remote_type: "remote",
    ir35_status: "outside",
    ir35_confidence: "medium",
    rate_min: 525,
    rate_max: 600,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: ["React", "TypeScript", "Next.js", "AWS"],
    posted_at: hoursAgo(75),
    first_seen_at: hoursAgo(74.8),
    description:
      "The engagement is stated as Outside IR35 in the listing. Build accessible React and TypeScript product surfaces for a UK research platform.",
    apply_url: "https://example.com/jobs/react",
    source_domain: "demo.ir35careers.local",
  },
  {
    id: "66666666-6666-4666-8666-666666666666",
    title: "Cyber Security Programme Manager",
    company_name: "Meridian Risk",
    location: "Edinburgh",
    remote_type: "onsite",
    ir35_status: "inside",
    ir35_confidence: "high",
    rate_min: 700,
    rate_max: 750,
    rate_currency: "GBP",
    rate_type: "daily",
    skills: ["Cyber Security", "Project Management", "GRC"],
    posted_at: hoursAgo(99),
    first_seen_at: hoursAgo(98.7),
    description:
      "Inside IR35 programme role coordinating security controls, governance and executive reporting. Four days per week on-site in Edinburgh.",
    apply_url: "https://example.com/jobs/cyber",
    source_domain: "demo.ir35careers.local",
  },
];

export function isDemoDataAvailable(): boolean {
  return (
    process.env.NODE_ENV !== "production" ||
    process.env.IR35CAREERS_E2E_DEMO_DATA === "1"
  );
}
