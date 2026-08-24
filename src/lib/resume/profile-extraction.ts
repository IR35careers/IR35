import { extractSkills } from "@/lib/processing/skills-extractor";

export interface ResumeProfilePrefill {
  fullName?: string;
  email?: string;
  phone?: string;
  location?: string;
  addressLine1?: string;
  city?: string;
  county?: string;
  postcode?: string;
  country?: string;
  linkedInUrl?: string;
  portfolioUrl?: string;
  githubUrl?: string;
  professionalSummary?: string;
  targetRole?: string;
  yearsOfExperience?: string;
  certifications?: string[];
  experienceText?: string;
  projectsText?: string;
  educationInstitution?: string;
  educationQualification?: string;
  availability?: string;
  noticePeriod?: string;
  clearance?: string;
  hasGovernmentClearance?: boolean;
  rightToWork?: "yes" | "no" | "needs_sponsorship";
  canWorkInPerson?: boolean;
  canRelocate?: boolean;
  canStartImmediately?: boolean;
  hasTransportation?: boolean;
  willingToTravel?: boolean;
  willingToWorkShifts?: boolean;
  willingToWorkWeekends?: boolean;
  targetDayRate?: string;
  targetAnnualSalary?: string;
  limitedCompanyName?: string;
  companyNumber?: string;
  vatRegistered?: boolean;
}

export interface ResumeProfileExtraction {
  prefill: ResumeProfilePrefill;
  detectedSkills: string[];
  suggestedSkills: string[];
  detectedFieldLabels: string[];
}

const UK_POSTCODE = /\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i;
const EMAIL = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE = /(?:\+?44\s?(?:\(0\)\s?)?|0)(?:\d[\s().-]?){9,10}\d/;
const URL = /(?:https?:\/\/|www\.)[^\s|,;]+/gi;
const LINKEDIN = /(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Z0-9%._~-]+\/?/i;
const GITHUB = /(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Z0-9_.-]+\/?/i;

const HEADING_ALIASES: Record<string, string[]> = {
  summary: ["profile", "professional profile", "summary", "professional summary", "career summary", "personal profile", "personal statement", "executive summary", "about me", "career objective", "objective"],
  skills: ["skills", "technical skills", "core skills", "key skills", "technologies", "technical expertise", "competencies"],
  experience: ["experience", "professional experience", "work experience", "employment history", "career history", "work history"],
  projects: ["projects", "selected projects", "key projects", "project experience"],
  education: ["education", "qualifications", "academic qualifications", "education and training"],
  certifications: ["certifications", "certificates", "professional certifications", "licenses and certifications", "licences and certifications", "certifications and licences", "accreditations"],
};

const ALL_HEADINGS = new Set(Object.values(HEADING_ALIASES).flat());
const ROLE_WORDS = /\b(engineer|developer|architect|analyst|manager|consultant|specialist|scientist|designer|administrator|director|lead|officer|contractor|programmer|technician)\b/i;
const NAME_BLOCKLIST = /\b(curriculum|vitae|resume|profile|summary|engineer|developer|architect|analyst|manager|consultant|specialist|scientist|director|lead|contractor)\b/i;

const RELATED_SKILLS: Record<string, string[]> = {
  JavaScript: ["TypeScript", "React", "Node.js", "Jest"],
  TypeScript: ["JavaScript", "React", "Node.js", "Next.js"],
  React: ["TypeScript", "Next.js", "Redux", "Jest"],
  "Node.js": ["TypeScript", "REST API", "Microservices", "PostgreSQL"],
  Python: ["FastAPI", "Django", "SQL", "AWS"],
  Java: ["Spring Boot", "Microservices", "SQL", "Kubernetes"],
  ".NET": ["C#", "Azure", "SQL Server", "Microservices"],
  AWS: ["Terraform", "Docker", "Kubernetes", "Serverless"],
  Azure: ["Terraform", "Docker", "Kubernetes", "PowerShell"],
  GCP: ["Terraform", "Docker", "Kubernetes", "Data Engineering"],
  DevOps: ["CI/CD", "Docker", "Kubernetes", "Terraform"],
  Kubernetes: ["Docker", "Terraform", "Helm", "CI/CD"],
  Terraform: ["AWS", "Azure", "GCP", "Ansible"],
  SQL: ["PostgreSQL", "SQL Server", "Data Engineering", "Power BI"],
  "Data Engineering": ["SQL", "Python", "Airflow", "dbt"],
  "Data Science": ["Python", "SQL", "Machine Learning", "Power BI"],
  "Machine Learning": ["Python", "Data Science", "NLP", "AI/LLM"],
  "Cyber Security": ["Penetration Testing", "AWS", "Azure", "Linux"],
  Salesforce: ["Business Analysis", "Agile", "Data Engineering"],
  "Business Analysis": ["Agile", "Jira", "Project Management", "Power BI"],
  "Project Management": ["Agile", "Jira", "Business Analysis", "Product Management"],
};

const SKILL_CLUSTERS = [
  ["JavaScript", "TypeScript", "React", "Next.js", "Vue", "Angular", "HTML", "CSS", "Redux"],
  ["Node.js", "Java", ".NET", "C#", "Python", "Spring Boot", "REST API", "GraphQL", "Microservices"],
  ["AWS", "Azure", "GCP", "DevOps", "Kubernetes", "Docker", "Terraform", "Ansible", "CI/CD", "Linux"],
  ["SQL", "PostgreSQL", "SQL Server", "Python", "Data Engineering", "Airflow", "dbt", "Snowflake", "Databricks", "Kafka"],
  ["Data Science", "Machine Learning", "Python", "SQL", "AI/LLM", "NLP", "Power BI", "Tableau"],
  ["Cypress", "Playwright", "Selenium", "Jest", "QA/Testing", "CI/CD"],
  ["Cyber Security", "Penetration Testing", "Linux", "AWS", "Azure", "SC Cleared", "DV Cleared"],
  ["Salesforce", "SAP", "Dynamics 365", "ServiceNow", "Workday", "Business Analysis", "Agile"],
  ["Project Management", "Product Management", "Business Analysis", "Agile", "Jira", "Solutions Architecture"],
  ["iOS", "Android", "Flutter", "React Native", "Swift", "Kotlin"],
] as const;

function cleanLine(value: string): string {
  return value.replace(/^[\s•·▪◦‣●*-]+/, "").replace(/\s+/g, " ").trim();
}

function normaliseUrl(value: string): string {
  const cleaned = value.replace(/[).,;]+$/, "");
  return /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned.replace(/^www\./i, "www.")}`;
}

function headingKey(line: string): string | null {
  const normalised = cleanLine(line).replace(/:$/, "").toLocaleLowerCase("en-GB");
  if (!ALL_HEADINGS.has(normalised)) return null;
  return Object.entries(HEADING_ALIASES).find(([, aliases]) => aliases.includes(normalised))?.[0] ?? null;
}

function sectionText(lines: string[], key: keyof typeof HEADING_ALIASES, limit: number): string {
  const start = lines.findIndex((line) => headingKey(line) === key);
  if (start < 0) return "";
  const body: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    if (headingKey(lines[index])) break;
    const line = lines[index].trim();
    if (line) body.push(line);
    if (body.join("\n").length >= limit) break;
  }
  return body.join("\n").slice(0, limit).trim();
}

function candidateName(lines: string[]): string {
  for (const raw of lines.slice(0, 12)) {
    const line = cleanLine(raw);
    const words = line.split(/\s+/);
    if (
      words.length >= 2 &&
      words.length <= 5 &&
      line.length <= 60 &&
      /^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)+$/u.test(line) &&
      !NAME_BLOCKLIST.test(line) &&
      !headingKey(line)
    ) return line;
  }
  return "";
}

function targetRole(lines: string[], name: string): string {
  for (const raw of lines.slice(0, 18)) {
    const line = cleanLine(raw);
    if (!line || line === name || line.length > 90 || headingKey(line)) continue;
    if (ROLE_WORDS.test(line) && !EMAIL.test(line) && !PHONE.test(line) && !line.includes("http")) return line;
  }
  return "";
}

function contactLocation(lines: string[], name: string, role: string): string {
  for (const raw of lines.slice(0, 15)) {
    const parts = raw.split(/[|•·]/).map(cleanLine).filter(Boolean);
    for (const part of parts) {
      if (
        part !== name &&
        part !== role &&
        part.length >= 2 &&
        part.length <= 70 &&
        !EMAIL.test(part) &&
        !PHONE.test(part) &&
        !part.match(URL) &&
        !headingKey(part) &&
        !ROLE_WORDS.test(part) &&
        (/\b(?:UK|United Kingdom|England|Scotland|Wales|Northern Ireland)\b/i.test(part) || /^[\p{L}' -]+(?:,\s*[\p{L}' -]+)?$/u.test(part))
      ) return part;
    }
  }
  return "";
}

function parseAddress(lines: string[]) {
  const topLines = lines.slice(0, 40).map(cleanLine);
  const postcodeIndex = topLines.findIndex((item) => UK_POSTCODE.test(item));
  if (postcodeIndex < 0) return {};
  const line = topLines[postcodeIndex];
  const postcode = line.match(UK_POSTCODE)?.[1].toUpperCase().replace(/\s+/, " ") ?? "";
  let beforePostcode = cleanLine(line.replace(UK_POSTCODE, "").replace(/[|,;-]+$/, ""));
  if (!beforePostcode) {
    const preceding = topLines
      .slice(Math.max(0, postcodeIndex - 3), postcodeIndex)
      .filter((item) => item && !EMAIL.test(item) && !PHONE.test(item) && !item.match(URL) && !headingKey(item));
    beforePostcode = preceding.join(", ");
  }
  const parts = beforePostcode.split(/\s*,\s*/).filter(Boolean);
  const hasCounty = parts.length >= 3;
  return {
    postcode,
    country: "United Kingdom",
    city: parts.length >= 2 ? parts[hasCounty ? parts.length - 2 : parts.length - 1] : undefined,
    county: hasCounty ? parts[parts.length - 1] : undefined,
    addressLine1: parts.length >= 2 ? parts.slice(0, hasCounty ? -2 : -1).join(", ") : undefined,
  };
}

function firstMatch(text: string, pattern: RegExp): string {
  return text.match(pattern)?.[0]?.trim() ?? "";
}

function splitList(value: string): string[] {
  return [...new Set(value.split(/\n|,|;|\s+[|]\s+/).map(cleanLine).filter((item) => item.length >= 2 && item.length <= 120))].slice(0, 16);
}

function escapePattern(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function labelledValue(lines: string[], labels: string[], maxLength = 160): string {
  const labelPattern = labels.map(escapePattern).join("|");
  const sameLine = new RegExp(`^(?:${labelPattern})\\s*(?::|[-–—])\\s*(.+)$`, "i");
  const labelOnly = new RegExp(`^(?:${labelPattern})\\s*:?$`, "i");
  for (let index = 0; index < lines.length; index += 1) {
    const line = cleanLine(lines[index]);
    const match = line.match(sameLine)?.[1]?.trim();
    if (match && match.length <= maxLength) return match;
    if (labelOnly.test(line)) {
      const next = lines.slice(index + 1, index + 4).map(cleanLine).find(Boolean);
      if (next && next.length <= maxLength && !headingKey(next)) return next;
    }
  }
  return "";
}

function explicitPreference(text: string, positive: RegExp, negative: RegExp): boolean | undefined {
  if (negative.test(text)) return false;
  if (positive.test(text)) return true;
  return undefined;
}

function rightToWorkValue(lines: string[]): ResumeProfilePrefill["rightToWork"] {
  const value = labelledValue(lines, ["right to work", "UK right to work", "work authorisation", "work authorization", "visa status", "sponsorship"]);
  if (!value) return undefined;
  if (/sponsor|visa required|require(?:s|d)? sponsorship/i.test(value)) return "needs_sponsorship";
  if (/^(?:no|none|not authorised|not authorized)$/i.test(value)) return "no";
  if (/^(?:yes|full|unrestricted|authorised|authorized|eligible|permanent)$/i.test(value) || /no sponsorship required/i.test(value)) return "yes";
  return undefined;
}

function availabilityValue(lines: string[]): string {
  const labelled = labelledValue(lines, ["availability", "available from", "start date", "earliest start date"]);
  if (labelled) return labelled;
  const match = lines.join("\n").match(/\b(?:available immediately|immediately available|available within \d+ (?:days?|weeks?)|available from [^\n]{3,40})\b/i);
  return match?.[0] ?? "";
}

function noticePeriodValue(lines: string[]): string {
  const labelled = labelledValue(lines, ["notice period", "current notice period"]);
  if (labelled) return labelled;
  return lines.join("\n").match(/\b(?:\d+|one|two|three|four|six|eight|twelve)\s+(?:working\s+)?(?:days?|weeks?|months?)\s+(?:notice|notice period)\b/i)?.[0] ?? "";
}

function clearanceValue(lines: string[]): string {
  const labelled = labelledValue(lines, ["security clearance", "clearance", "government clearance"]);
  if (labelled) return labelled;
  return lines.join("\n").match(/\b(?:active\s+)?(?:DV|SC|CTC|BPSS|NPPV[1-3])\s+(?:clearance|cleared)\b/i)?.[0] ?? "";
}

function currencyValue(lines: string[], labels: string[], suffixPattern: RegExp): string {
  const labelled = labelledValue(lines, labels);
  const labelledAmount = labelled.match(/(?:£|GBP\s*)\d{2,3}(?:,\d{3})?(?:\.\d{1,2})?/i)?.[0];
  if (labelledAmount) return labelledAmount.replace(/^GBP\s*/i, "£");
  const match = lines.join("\n").match(suffixPattern)?.[1];
  return match?.replace(/^GBP\s*/i, "£") ?? "";
}

function yearsOfExperienceValue(text: string, experience: string): string {
  const explicit = text.match(/\b(\d{1,2})\+?\s+years?(?:\s+of)?\s+(?:professional\s+|relevant\s+)?experience\b/i)?.[1];
  if (explicit) return explicit;
  const currentYear = new Date().getUTCFullYear();
  const years = [...experience.matchAll(/\b((?:19|20)\d{2})\b/g)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= 1970 && year <= currentYear);
  if (!years.length || !/\b(?:present|current|now|ongoing)\b/i.test(experience)) return "";
  const derived = currentYear - Math.min(...years);
  return derived >= 1 && derived <= 50 ? String(derived) : "";
}

function companyDetails(lines: string[]) {
  const companyName = labelledValue(lines, ["limited company", "limited company name", "company name", "personal service company", "PSC"]);
  const number = labelledValue(lines, ["company number", "Companies House number", "registration number"])
    .match(/\b(?:[A-Z]{2}\d{6}|\d{8})\b/i)?.[0]?.toUpperCase() ?? "";
  const vatValue = labelledValue(lines, ["VAT registered", "VAT registration", "VAT number"]);
  const vatRegistered = vatValue
    ? !/^(?:no|not registered|n\/a|none)$/i.test(vatValue)
    : undefined;
  return { companyName, number, vatRegistered };
}

function fieldLabels(prefill: ResumeProfilePrefill): string[] {
  const labels: Partial<Record<keyof ResumeProfilePrefill, string>> = {
    fullName: "name",
    email: "email",
    phone: "phone",
    location: "location",
    addressLine1: "address",
    city: "town or city",
    county: "county or region",
    postcode: "postcode",
    country: "country",
    linkedInUrl: "LinkedIn",
    portfolioUrl: "portfolio",
    githubUrl: "GitHub",
    professionalSummary: "professional summary",
    targetRole: "target role",
    yearsOfExperience: "years of experience",
    certifications: "certifications",
    experienceText: "experience",
    projectsText: "projects",
    educationInstitution: "education institution",
    educationQualification: "qualification",
    availability: "availability",
    noticePeriod: "notice period",
    clearance: "security clearance",
    hasGovernmentClearance: "government clearance answer",
    rightToWork: "UK work authorisation",
    canWorkInPerson: "in-person work preference",
    canRelocate: "relocation preference",
    canStartImmediately: "start preference",
    hasTransportation: "transport",
    willingToTravel: "travel preference",
    willingToWorkShifts: "shift preference",
    willingToWorkWeekends: "weekend preference",
    targetDayRate: "target day rate",
    targetAnnualSalary: "target annual salary",
    limitedCompanyName: "limited company",
    companyNumber: "company number",
    vatRegistered: "VAT registration",
  };
  return (Object.keys(prefill) as Array<keyof ResumeProfilePrefill>).map((key) => labels[key]).filter((value): value is string => Boolean(value));
}

export function extractResumeProfile(text: string): ResumeProfileExtraction {
  const lines = text.replace(/\u0000/g, "").replace(/\r\n?/g, "\n").split("\n");
  const flattened = lines.join("\n");
  const name = candidateName(lines);
  const role = targetRole(lines, name);
  const email = firstMatch(flattened, EMAIL);
  const phone = firstMatch(flattened, PHONE);
  const linkedIn = firstMatch(flattened, LINKEDIN);
  const github = firstMatch(flattened, GITHUB);
  const urls = flattened.match(URL) ?? [];
  const portfolio = urls.map(normaliseUrl).find((url) => !/linkedin\.com|github\.com/i.test(url)) ?? "";
  const summary = sectionText(lines, "summary", 1_800);
  const experience = sectionText(lines, "experience", 7_000);
  const projects = sectionText(lines, "projects", 4_000);
  const education = sectionText(lines, "education", 2_000);
  const certificationText = sectionText(lines, "certifications", 2_000);
  const address = parseAddress(lines);
  const location = contactLocation(lines, name, role);
  const years = yearsOfExperienceValue(flattened, experience);
  const educationLines = education.split("\n").map(cleanLine).filter(Boolean);
  const qualification = educationLines.find((line) => /\b(?:BSc|MSc|BA|MA|BEng|MEng|MBA|PhD|Bachelor|Master|Diploma|Degree|HND|NVQ)\b/i.test(line)) ?? "";
  const institution = educationLines.find((line) => /\b(?:University|College|Institute|School)\b/i.test(line)) ?? "";
  const availability = availabilityValue(lines);
  const noticePeriod = noticePeriodValue(lines);
  const clearance = clearanceValue(lines);
  const rightToWork = rightToWorkValue(lines);
  const dayRate = currencyValue(lines, ["target day rate", "desired day rate", "contract rate", "day rate"], /((?:£|GBP\s*)\d{2,3}(?:,\d{3})?(?:\.\d{1,2})?)\s*(?:per\s+day|\/\s*day|pd)\b/i);
  const annualSalary = currencyValue(lines, ["target annual salary", "desired salary", "salary expectation", "target salary"], /((?:£|GBP\s*)\d{2,3}(?:,\d{3})?(?:\.\d{1,2})?)\s*(?:per\s+(?:year|annum)|\/\s*(?:year|annum)|pa)\b/i);
  const company = companyDetails(lines);
  const startImmediately = availability ? /\b(?:immediate|immediately|now)\b/i.test(availability) : undefined;
  const hasClearance = clearance && !/\b(?:eligible|expired|lapsed|previously)\b/i.test(clearance) ? true : undefined;
  const canWorkInPerson = explicitPreference(flattened, /\b(?:open|available|willing)\s+to\s+(?:work\s+)?(?:on[- ]?site|in person|hybrid)\b/i, /\b(?:remote only|not (?:available|willing) to (?:work )?(?:on[- ]?site|in person))\b/i);
  const canRelocate = explicitPreference(flattened, /\b(?:open|willing) to relocat(?:e|ion)\b/i, /\b(?:not willing to relocate|relocation not possible|no relocation)\b/i);
  const hasTransportation = explicitPreference(flattened, /\b(?:own transport|reliable transport|access to (?:a )?(?:car|vehicle)|full UK driving licence and (?:a )?(?:car|vehicle))\b/i, /\b(?:no transport|no access to (?:a )?(?:car|vehicle))\b/i);
  const willingToTravel = explicitPreference(flattened, /\bwilling to travel\b/i, /\b(?:not willing to travel|no travel)\b/i);
  const willingToWorkShifts = explicitPreference(flattened, /\bwilling to work shifts\b/i, /\b(?:not willing to work shifts|no shift work)\b/i);
  const willingToWorkWeekends = explicitPreference(flattened, /\bwilling to work weekends\b/i, /\b(?:not willing to work weekends|no weekend work)\b/i);
  const prefill: ResumeProfilePrefill = {
    ...(name ? { fullName: name } : {}),
    ...(email ? { email } : {}),
    ...(phone ? { phone: phone.replace(/\s+/g, " ") } : {}),
    ...(location ? { location } : {}),
    ...address,
    ...(linkedIn ? { linkedInUrl: normaliseUrl(linkedIn) } : {}),
    ...(github ? { githubUrl: normaliseUrl(github) } : {}),
    ...(portfolio ? { portfolioUrl: portfolio } : {}),
    ...(summary ? { professionalSummary: summary } : {}),
    ...(role ? { targetRole: role } : {}),
    ...(years ? { yearsOfExperience: years } : {}),
    ...(availability ? { availability } : {}),
    ...(noticePeriod ? { noticePeriod } : {}),
    ...(clearance ? { clearance } : {}),
    ...(hasClearance !== undefined ? { hasGovernmentClearance: hasClearance } : {}),
    ...(rightToWork ? { rightToWork } : {}),
    ...(canWorkInPerson !== undefined ? { canWorkInPerson } : {}),
    ...(canRelocate !== undefined ? { canRelocate } : {}),
    ...(startImmediately !== undefined ? { canStartImmediately: startImmediately } : {}),
    ...(hasTransportation !== undefined ? { hasTransportation } : {}),
    ...(willingToTravel !== undefined ? { willingToTravel } : {}),
    ...(willingToWorkShifts !== undefined ? { willingToWorkShifts } : {}),
    ...(willingToWorkWeekends !== undefined ? { willingToWorkWeekends } : {}),
    ...(dayRate ? { targetDayRate: dayRate } : {}),
    ...(annualSalary ? { targetAnnualSalary: annualSalary } : {}),
    ...(company.companyName ? { limitedCompanyName: company.companyName } : {}),
    ...(company.number ? { companyNumber: company.number } : {}),
    ...(company.vatRegistered !== undefined ? { vatRegistered: company.vatRegistered } : {}),
    ...(certificationText ? { certifications: splitList(certificationText) } : {}),
    ...(experience ? { experienceText: experience } : {}),
    ...(projects ? { projectsText: projects } : {}),
    ...(institution ? { educationInstitution: institution } : {}),
    ...(qualification ? { educationQualification: qualification } : {}),
  };
  const detectedSkills = extractSkills("", flattened);
  const clusterSuggestions = SKILL_CLUSTERS
    .filter((cluster) => cluster.some((skill) => detectedSkills.includes(skill)))
    .flatMap((cluster) => [...cluster]);
  const suggestedSkills = [
    ...new Set([
      ...detectedSkills.flatMap((skill) => RELATED_SKILLS[skill] ?? []),
      ...clusterSuggestions,
    ]),
  ]
    .filter((skill) => !detectedSkills.includes(skill))
    .slice(0, 12);

  return {
    prefill,
    detectedSkills,
    suggestedSkills,
    detectedFieldLabels: fieldLabels(prefill),
  };
}
