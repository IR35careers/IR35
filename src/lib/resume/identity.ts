import { normalizeLocation } from "@/lib/processing/location-normalizer";
import { normaliseResumeText } from "./normalise-text";

const ROLE_OR_DOCUMENT = /\b(?:curriculum|vitae|resume|cv|candidate|applicant|profile|summary|engineer|developer|architect|analyst|manager|consultant|specialist|scientist|designer|administrator|director|lead|officer|contractor|clearance|cleared)\b/i;
const TECHNICAL_WORDS = new Set("cloud platform platforms technical skills core key technologies technology expertise competencies professional experience employment education certifications security infrastructure networking databases data automation rbac iam aws azure gcp kubernetes terraform docker linux api sql contact details personal information application full name given family objective awards hobbies interests reference references and of".split(" "));
const ACRONYMS = new Set(["AWS", "IAM", "GCP", "API", "SQL", "RBAC", "HTML", "CSS"]);
const COUNTRY = /^(?:UK|United Kingdom|England|Scotland|Wales|Northern Ireland|Great Britain|United States)$/i;

export function isTechnicalIdentityLine(value: string): boolean {
  const words = value.toLocaleLowerCase("en-GB").match(/[\p{L}]+/gu) ?? [];
  return words.length > 0 && words.every(word => TECHNICAL_WORDS.has(word));
}

/** Extraction repair only: never invent word boundaries that are no longer in the source. */
export function normaliseExtractedCvText(value: string): string {
  const lines = value.normalize("NFC").replace(/[\u0000\uFEFF]/g, "").replace(/\r\n?/g, "\n").split("\n");
  return normaliseResumeText(lines.map(line => {
    const firstContent = line.search(/\S/u);
    return line.replace(
      /(?<![\p{L}\p{N}])\p{L}(?:[ \t]\p{L}){2,}(?![\p{L}\p{N}])/gu,
      (run: string, offset: number) => {
        const joined = run.replace(/[ \t]/g, "");
        // Three initials followed by a surname are ambiguous. Slice the suffix
        // only for the initial run, not repeatedly over a long extracted line.
        if (joined.length <= 3 && offset === firstContent && !ACRONYMS.has(joined) &&
          /^\p{L}{2,}/u.test(line.slice(offset + run.length).trimStart())) return run;
        return joined;
      },
    );
  }).join("\n"));
}

/** PDF.js word-separator items retain boundaries that flattened text loses. */
export function normalisePdfTextItems(pages: Array<Array<{ str: string; hasEOL: boolean }>>): string {
  const raw = pages.map(page => page.map(item => {
    // Two spaces protect an explicit item boundary from the single-letter-run
    // repair. Never guess a split inside an item that has no word boundary.
    const text = item.str.replace(/^[ \t]+|[ \t]+$/g, "  ");
    return text + (item.hasEOL ? "\n" : "");
  }).join("")).join("\n");
  return normaliseExtractedCvText(raw).replace(/[ \t]{2,}/g, " ");
}

function knownPlace(value: string): boolean {
  const location = normalizeLocation(value);
  return COUNTRY.test(value) || (location.isUK && !/^remote/i.test(location.location) &&
    location.location.toLocaleLowerCase("en-GB") === value.toLocaleLowerCase("en-GB"));
}

export function isPlausibleCandidateName(value: string): boolean {
  const clean = value.normalize("NFC").trim();
  const words = clean.split(/\s+/);
  return clean.length <= 80 && words.length >= 2 && words.length <= 5 &&
    /^[\p{L}][\p{L}\p{M}'’.\-]*(?:\s+[\p{L}][\p{L}\p{M}'’.\-]*)+$/u.test(clean) &&
    words.some(word => word.replace(/[^\p{L}]/gu, "").length > 1) &&
    words.every(word => word.length > 1 || /^\p{Lu}$/u.test(word) || !/\p{Script=Latin}/u.test(word)) &&
    words.filter(word => /^\p{Lu}/u.test(word) || !/\p{Script=Latin}/u.test(word)).length >= 2 &&
    !/^(?:built|developed|delivered|implemented|managed|designed|responsible|experienced)\b/i.test(clean) &&
    !ROLE_OR_DOCUMENT.test(clean) && !isTechnicalIdentityLine(clean) && !knownPlace(clean);
}

/** Unknown towns need explicit contact/label context; arbitrary prose is not a place. */
export function isPlausibleContactLocation(value: string, explicitContactContext = false): boolean {
  const clean = value.trim();
  if (!clean || clean.length > 70 || ROLE_OR_DOCUMENT.test(clean) || isTechnicalIdentityLine(clean) ||
    /\b(?:remote|hybrid|on[- ]?site|willing|available|relocat\w*|rbac|iam|terraform|kubernetes|built|delivered|responsible|experience|skills|years)\b/i.test(clean) ||
    !/^[\p{L}\p{M}'’. -]+(?:,\s*[\p{L}\p{M}'’. -]+){0,3}$/u.test(clean)) return false;
  const parts = clean.split(/,\s*/);
  return explicitContactContext || knownPlace(clean) || (parts.length >= 2 && COUNTRY.test(parts.at(-1)!));
}

/** An explicit contractor identity wins over document heuristics, including single names. */
export function resolveCvCandidateName(explicitName: string | undefined, documentName: string): string {
  const explicit = explicitName?.normalize("NFC").replace(/\s+/g, " ").trim() ?? "";
  if (explicit && explicit.length <= 100 && /^[\p{L}][\p{L}\p{M}'’. -]*$/u.test(explicit) &&
    !ROLE_OR_DOCUMENT.test(explicit) && !isTechnicalIdentityLine(explicit) && !knownPlace(explicit)) return explicit;
  return isPlausibleCandidateName(documentName) ? documentName : "Candidate";
}

export function cvDisplayTitle(explicitName?: string, documentName = ""): string {
  const name = resolveCvCandidateName(explicitName, documentName);
  return name === "Candidate" ? "Your CV" : `${name} CV`;
}
