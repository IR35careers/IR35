/**
 * Location Normalizer + Remote Type Detector
 *
 * Two jobs:
 * 1. Map the chaos of ATS location strings ("London (City)", "Greater
 *    London", "Remote - UK", "Manchester, England, United Kingdom") onto
 *    canonical values, and decide whether the role is UK-relevant at all —
 *    the board is UK-only, and many companies on public ATS boards hire
 *    globally, so non-UK roles must be dropped upstream.
 * 2. Classify workplace type: remote / hybrid / onsite / unknown.
 */

import type { RemoteType } from "../ats/types";

const CANONICAL_CITIES = [
  "London",
  "Manchester",
  "Birmingham",
  "Leeds",
  "Edinburgh",
  "Glasgow",
  "Bristol",
  "Liverpool",
  "Newcastle",
  "Sheffield",
  "Cardiff",
  "Belfast",
  "Nottingham",
  "Cambridge",
  "Oxford",
  "Reading",
  "Brighton",
  "Milton Keynes",
  "Leicester",
  "Coventry",
  "Southampton",
  "Portsmouth",
  "York",
  "Bath",
  "Exeter",
  "Aberdeen",
  "Dundee",
  "Swindon",
  "Cheltenham",
  "Gloucester",
  "Luton",
  "Watford",
  "Guildford",
  "Slough",
  "Basingstoke",
  "Northampton",
  "Derby",
  "Hull",
  "Preston",
  "Swansea",
  "Warrington",
  "Solihull",
];

// Variants that should map to a canonical city.
const CITY_ALIASES: Record<string, string> = {
  "greater london": "London",
  "city of london": "London",
  "central london": "London",
  "london city": "London",
  "canary wharf": "London",
  "greater manchester": "Manchester",
  "newcastle upon tyne": "Newcastle",
  "kingston upon hull": "Hull",
};

const UK_MARKERS =
  /\b(uk|u\.k\.|united kingdom|england|scotland|wales|northern ireland|great britain|gb)\b/i;

// Locations that clearly place a role outside the UK. Checked before the
// city scan so "New York, NY" can never match the UK city "York", and
// "London, Ontario" can never match London. "Ireland" alone is foreign, but
// "Northern Ireland" is UK — the UK_MARKERS check below runs first.
const FOREIGN_MARKERS =
  /\b(usa?|u\.s\.a?\.?|united states|america|new york|california|texas|florida|washington|boston|chicago|austin|seattle|canada|ontario|toronto|vancouver|australia|sydney|melbourne|new zealand|germany|berlin|munich|france|paris|spain|madrid|barcelona|portugal|lisbon|netherlands|amsterdam|belgium|poland|warsaw|romania|india|bangalore|mumbai|delhi|singapore|japan|tokyo|china|brazil|mexico|argentina|south africa|dubai|uae|ireland|dublin|italy|milan|rome|sweden|stockholm|norway|denmark|copenhagen|finland|switzerland|zurich|austria|vienna|emea|europe)\b/i;

export interface NormalizedLocation {
  /** Canonical display value, e.g. "London", "Remote (UK)", or cleaned original */
  location: string;
  /** Whether this role is plausibly UK-based (or UK-remote) */
  isUK: boolean;
}

export function normalizeLocation(rawLocation: string): NormalizedLocation {
  const raw = (rawLocation ?? "").trim();
  const lower = raw.toLowerCase();

  if (!raw) return { location: "Unknown", isUK: false };

  const mentionsRemote = /\bremote\b/i.test(raw);
  const mentionsUK = UK_MARKERS.test(raw);
  const mentionsForeign = FOREIGN_MARKERS.test(raw);

  // A location that names a non-UK place (and no UK marker) is out,
  // regardless of any substring resemblance to a UK city.
  if (mentionsForeign && !mentionsUK) {
    return { location: raw.replace(/\s+/g, " "), isUK: false };
  }

  // Alias map first (most specific).
  for (const [alias, canonical] of Object.entries(CITY_ALIASES)) {
    if (lower.includes(alias)) return { location: canonical, isUK: true };
  }

  // Canonical city mention anywhere in the string.
  for (const city of CANONICAL_CITIES) {
    const re = new RegExp(String.raw`\b${city.replace(/ /g, String.raw`\s+`)}\b`, "i");
    if (re.test(raw)) return { location: city, isUK: true };
  }

  if (mentionsRemote && mentionsUK) return { location: "Remote (UK)", isUK: true };
  if (mentionsRemote) {
    // Bare "Remote" with no country named: kept as maybe-UK — the processor
    // pairs this with a UK-market signal (GBP rate or IR35 mention) before
    // accepting it. Foreign-remote was already rejected above.
    return { location: "Remote", isUK: true };
  }

  if (mentionsUK) return { location: raw.replace(/\s+/g, " "), isUK: true };

  return { location: raw.replace(/\s+/g, " "), isUK: false };
}

/**
 * Decide remote / hybrid / onsite from the location string + description.
 * Order matters: explicit hybrid signals beat generic "remote" mentions
 * (descriptions love saying "remote working available, 2 days in office").
 */
export function detectRemoteType(location: string, description: string): RemoteType {
  const text = `${location ?? ""} ${description ?? ""}`;

  const hybridSignals =
    /\bhybrid\b|\b\d\s*(?:-\s*\d\s*)?days?\s+(?:per\s+week\s+)?(?:in|on)\s+(?:the\s+)?(?:office|site)\b|\boffice\s+\d\s*days?\b|\bsplit\s+between\s+home\s+and\s+office\b/i;
  const remoteSignals =
    /\b(?:fully|100%)\s+remote\b|\bremote\s*(?:-|—)?\s*(?:first|only|uk)\b|\bwork\s+from\s+home\b|\bwfh\b|\bremote\b/i;
  const onsiteSignals =
    /\b(?:fully\s+)?(?:on\s*-?\s*site|office)\s*(?:based|only)\b|\b5\s*days?\s+(?:per\s+week\s+)?(?:in|on)\s+(?:the\s+)?(?:office|site)\b/i;

  if (hybridSignals.test(text)) return "hybrid";
  if (onsiteSignals.test(text)) return "onsite";
  if (remoteSignals.test(text)) return "remote";

  // A concrete city with no remote/hybrid wording defaults to onsite-ish,
  // but without explicit wording we stay honest:
  return "unknown";
}
