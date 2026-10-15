import { createHash } from "node:crypto";
import type { JobDetail } from "@/lib/job-types";
import { isProfessionalRole } from "./job-processor";
import { isPrimarySapRole } from "./skills-extractor";
import { findRateInText, parseRate } from "./rate-parser";

export interface QualityJob extends JobDetail {
  rate_confidence?: string;
  rate_raw?: string | null;
}
export interface QualityChange {
  id: string;
  reason: string;
  before: Record<string, unknown>;
  after: Record<string, unknown>;
}
const normalise = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Conservative, reversible repairs. No hard deletes or guessed IR35/salary. */
export function planJobQuality(jobs: QualityJob[], decimalRatesEnabled = false) {
  const changes: QualityChange[] = [];
  let deferredDecimalRates = 0;
  const identities = new Map<string, QualityJob[]>();
  for (const job of [...jobs].sort((a, b) => a.first_seen_at.localeCompare(b.first_seen_at) || a.id.localeCompare(b.id))) {
    const rate = { min: job.rate_min, max: job.rate_max, type: job.rate_type, currency: job.rate_currency, confidence: "low" as const, raw: "" };
    if (!isProfessionalRole(job.title, rate)) {
      changes.push({ id: job.id, reason: "off_topic_or_below_professional_rate", before: { expired_at: null, title: job.title, rate_min: job.rate_min, rate_max: job.rate_max, rate_type: job.rate_type }, after: { expired_at: "REPAIR_TIME" } });
      continue;
    }
    const key = [job.title, job.company_name, job.location].map(normalise).join("|");
    const sameIdentity = identities.get(key) ?? [];
    const duplicate = sameIdentity.find(other =>
      normalise(job.description).length >= 80
      && normalise(job.description) === normalise(other.description)
      && job.rate_type === other.rate_type && job.rate_min === other.rate_min && job.rate_max === other.rate_max
      && job.rate_currency === other.rate_currency && job.remote_type === other.remote_type && job.ir35_status === other.ir35_status);
    if (duplicate) {
      changes.push({ id: job.id, reason: `duplicate_of:${duplicate.id}`, before: { expired_at: null, title: job.title, company_name: job.company_name, location: job.location, description: job.description, ...(job.last_seen_at ? { last_seen_at: job.last_seen_at } : {}), rate_min: job.rate_min, rate_max: job.rate_max, rate_type: job.rate_type }, after: { expired_at: "REPAIR_TIME" } });
      continue;
    }
    sameIdentity.push(job); identities.set(key, sameIdentity);
    const before: Record<string, unknown> = {};
    const after: Record<string, unknown> = {};
    if (job.skills.includes("SAP") && !isPrimarySapRole(job.title, job.description)) {
      before.skills = job.skills; after.skills = job.skills.filter(skill => skill !== "SAP");
    }
    if (job.rate_min === null && job.rate_max === null) {
      const found = findRateInText(job.description);
      // parseRate(circa...) estimates a range; never backfill that as advertised pay.
      if (found.raw && parseRate(found.raw).confidence === "high") {
        const fractional = [found.min, found.max].some(value => value !== null && !Number.isInteger(value));
        if (fractional && !decimalRatesEnabled) {
          deferredDecimalRates++;
        } else {
        Object.assign(before, { rate_min: null, rate_max: null, rate_type: job.rate_type, rate_currency: job.rate_currency, rate_confidence: job.rate_confidence ?? "low", rate_raw: job.rate_raw ?? null });
        Object.assign(after, { rate_min: found.min, rate_max: found.max, rate_type: found.type, rate_currency: found.currency, rate_confidence: found.confidence, rate_raw: found.raw });
        }
      }
    }
    if (Object.keys(after).length) changes.push({ id: job.id, reason: "advertised_evidence_backfill", before, after });
  }
  const counts = {
    checked: jobs.length,
    offTopic: changes.filter(change => change.reason === "off_topic_or_below_professional_rate").length,
    duplicates: changes.filter(change => change.reason.startsWith("duplicate_of:")).length,
    sapTags: changes.filter(change => "skills" in change.after).length,
    rates: changes.filter(change => "rate_min" in change.after).length,
    deferredDecimalRates,
    missingOriginalPostingDate: jobs.filter(job => !job.posted_at).length,
  };
  return { changes, counts, planHash: hash(changes) };
}
