import type { JobDetail } from "@/lib/job-types";
import { classifyIR35 } from "@/lib/processing/ir35-classifier";
import { detectRemoteType } from "@/lib/processing/location-normalizer";
import { findRateInText, parseRate } from "@/lib/processing/rate-parser";
import { extractSkills } from "@/lib/processing/skills-extractor";
import { stripHtml } from "@/lib/processing/job-processor";

type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function findJobPosting(value: unknown): JsonRecord | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPosting(item);
      if (found) return found;
    }
    return null;
  }
  const object = record(value);
  if (!object) return null;
  const types = Array.isArray(object["@type"]) ? object["@type"] : [object["@type"]];
  if (types.some((type) => stringValue(type).toLowerCase() === "jobposting")) return object;
  return findJobPosting(object["@graph"]);
}

function meta(html: string, key: string): string {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i"),
  ];
  return patterns.map((pattern) => html.match(pattern)?.[1] ?? "").find(Boolean) ?? "";
}

function address(job: JsonRecord): string {
  if (stringValue(job.jobLocationType).toLowerCase().includes("telecommute")) return "Remote";
  const locations = Array.isArray(job.jobLocation) ? job.jobLocation : [job.jobLocation];
  for (const locationValue of locations) {
    const location = record(locationValue);
    const addr = record(location?.address);
    const parts = [addr?.addressLocality, addr?.addressRegion, addr?.addressCountry]
      .map(stringValue)
      .filter(Boolean);
    if (parts.length) return [...new Set(parts)].join(", ");
  }
  return "Location not stated";
}

function salaryText(job: JsonRecord): string {
  const salary = record(job.baseSalary);
  if (!salary) return "";
  const currency = stringValue(salary.currency) || "GBP";
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : currency === "EUR" ? "€" : `${currency} `;
  const value = record(salary.value);
  const minimum = Number(value?.minValue ?? value?.value);
  const maximum = Number(value?.maxValue ?? value?.value);
  const unit = stringValue(value?.unitText).toLowerCase();
  const suffix = unit.includes("hour")
    ? " per hour"
    : unit.includes("year")
      ? " per annum"
      : unit.includes("day")
        ? " per day"
        : "";
  if (Number.isFinite(minimum) && Number.isFinite(maximum) && minimum !== maximum) return `${symbol}${minimum}-${symbol}${maximum}${suffix}`;
  if (Number.isFinite(maximum)) return `${symbol}${maximum}${suffix}`;
  return "";
}

export function parseExternalJobHtml(html: string, sourceUrl: string, id: string): JobDetail {
  const scripts = [...html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  let job: JsonRecord | null = null;
  for (const script of scripts) {
    try {
      job = findJobPosting(JSON.parse(script[1]));
      if (job) break;
    } catch {
      // Malformed third-party JSON-LD is ignored; metadata fallback remains.
    }
  }

  const parsedUrl = new URL(sourceUrl);
  const title = stringValue(job?.title) || meta(html, "og:title") || stripHtml(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "External contract role") || "External contract role";
  const organisation = record(job?.hiringOrganization);
  const company = stringValue(organisation?.name) || meta(html, "og:site_name") || parsedUrl.hostname.replace(/^www\./, "");
  const description = stripHtml(stringValue(job?.description) || meta(html, "description") || meta(html, "og:description")).slice(0, 100_000);
  const location = job ? address(job) : "Location not stated";
  const salary = job ? salaryText(job) : "";
  const rate = salary ? parseRate(salary) : findRateInText(description);
  const ir35 = classifyIR35(title, description);
  const now = new Date().toISOString();

  return {
    id,
    title: title.slice(0, 240),
    company_name: company.slice(0, 160),
    description: description || "The source did not expose a readable job description. Review the original page before acting.",
    location: location.slice(0, 160),
    remote_type: detectRemoteType(location, description),
    ir35_status: ir35.status,
    ir35_confidence: ir35.confidence,
    rate_min: rate.min,
    rate_max: rate.max,
    rate_currency: rate.currency,
    rate_type: rate.type,
    skills: extractSkills(title, description),
    posted_at: stringValue(job?.datePosted) || null,
    first_seen_at: now,
    last_seen_at: now,
    source_domain: parsedUrl.hostname,
    apply_url: sourceUrl,
  };
}
