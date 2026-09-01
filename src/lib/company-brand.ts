const COMPANY_DOMAIN_ENTRIES = [
  // Employers and agencies currently represented in the UK contract feed.
  ["rnli", "rnli.org"],
  ["ignition driver recruitment", "ignitiondriverrecruitment.com"],
  ["nexus people", "nexuspeople.co.uk"],
  ["rise technical recruitment", "risetechnical.co.uk"],
  ["medirest", "medirest.co.uk"],
  ["brook street", "brookstreet.co.uk"],
  ["brook street uk", "brookstreet.co.uk"],
  ["morson", "morson.com"],
  ["morson edge", "morson.com"],
  ["swarovski", "swarovski.com"],
  ["swarovski uk", "swarovski.com"],
  ["newlon housing trust", "newlon.org.uk"],
  ["public sector resourcing", "publicsectorresourcing.co.uk"],
  ["public sector resourcing cws", "publicsectorresourcing.co.uk"],
  ["rathbones", "rathbones.com"],
  ["rathbones group", "rathbones.com"],
  ["people solutions", "peoplesolutions.co.uk"],
  ["academics", "academicsltd.co.uk"],
  ["motability operations", "motabilityoperations.co.uk"],
  ["hays", "hays.co.uk"],
  ["jam recruitment", "jamrecruitment.co.uk"],
  ["outsource", "outsource-uk.co.uk"],
  ["guidant global", "guidantglobal.com"],
  ["the extracare charitable trust t a extracare", "extracare.org.uk"],
  ["extracare", "extracare.org.uk"],
  ["edex education recruitment", "edex.co.uk"],
  ["lynx employment services", "lynxemployment.co.uk"],
  ["ams", "weareams.com"],
  ["ams cws", "weareams.com"],
  ["oakleaf partnership", "oakleafpartnership.com"],
  ["alzheimers society", "alzheimers.org.uk"],
  ["complete fixing solutions", "completefixingsolutions.co.uk"],

  // Direct-employer feeds supported by the ingestion registry.
  ["monzo", "monzo.com"],
  ["gocardless", "gocardless.com"],
  ["trustpilot", "trustpilot.com"],
  ["form3", "form3.tech"],
  ["twinstream", "twinstream.com"],
  ["adaptive financial consulting", "adaptivefinancialconsulting.com"],
  ["playstation global", "playstation.com"],
  ["liquid personnel", "liquidpersonnel.com"],
  ["capco", "capco.com"],
  ["wongdoody", "wongdoody.com"],
  ["pulse healthcare", "pulsejobs.com"],
  ["octopus energy", "octopus.energy"],
  ["multiverse", "multiverse.io"],
  ["synthesia", "synthesia.io"],
  ["deliveroo", "deliveroo.co.uk"],
  ["blockchain com", "blockchain.com"],
  ["starling bank", "starlingbank.com"],
  ["focus group", "focusgroup.co.uk"],
  ["onbuy", "onbuy.com"],
  ["safran engineering services uk", "safran-group.com"],
  ["mindera", "mindera.com"],
  ["sword group", "sword-group.com"],
  ["general dynamics mission systems", "gdmissionsystems.com"],
  ["telefonica tech", "telefonicatech.com"],
] as const;

const COMPANY_DOMAINS = new Map<string, string>(COMPANY_DOMAIN_ENTRIES);

export function normaliseCompanyName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function companyCandidates(companyName: string): string[] {
  const normalised = normaliseCompanyName(companyName);
  if (!normalised) return [];

  const withoutPrefix = normalised.replace(/^the\s+/, "");
  const withoutSuffix = withoutPrefix
    .replace(/\s+(?:limited|ltd|plc|llp|incorporated|inc)$/g, "")
    .trim();

  return [...new Set([normalised, withoutPrefix, withoutSuffix])];
}

/**
 * Resolve only explicitly verified employer domains. This intentionally does
 * not guess `company-name.com`: a wrong logo is less trustworthy than a clear
 * monogram fallback.
 */
export function getCompanyLogoDomain(companyName: string): string | null {
  for (const candidate of companyCandidates(companyName)) {
    const domain = COMPANY_DOMAINS.get(candidate);
    if (domain) return domain;
  }
  return null;
}

export function getCompanyLogoPath(companyName: string): string | null {
  return getCompanyLogoDomain(companyName)
    ? `/api/company-logo?company=${encodeURIComponent(companyName)}`
    : null;
}

export function getCompanyInitials(companyName: string): string {
  const words = normaliseCompanyName(companyName)
    .split(" ")
    .filter((word) => word && !["the", "and", "of", "uk", "ltd", "limited", "plc"].includes(word));
  if (words.length === 0) return "";
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase();
}

