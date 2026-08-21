import { FACT_KEYS, type FactKey, type FieldMapping, type RunnerFacts, type RunnerField } from "@/lib/application-runner/types";

const PATTERNS: Array<[FactKey, RegExp]> = [
  ["first_name", /\b(first|given)\s*name\b/i],
  ["last_name", /\b(last|family|sur)\s*name\b/i],
  ["full_name", /\b(full|legal)\s*name\b|^name$/i],
  ["email", /e-?mail/i],
  ["phone", /phone|mobile|telephone/i],
  ["postcode", /post\s*code|postal\s*code|zip\s*code/i],
  ["address", /street|address\s*(line)?\s*1/i],
  ["city", /\bcity\b|town/i],
  ["county", /county|state|province|region/i],
  ["country", /country/i],
  ["linkedin", /linkedin/i],
  ["portfolio", /portfolio|personal\s*(site|website)|github|website/i],
  ["notice_period", /notice\s*period/i],
  ["availability", /availability|available\s*(from|to start)|start\s*date/i],
  ["needs_sponsorship", /sponsor|visa/i],
  ["right_to_work", /right\s*to\s*work|authori[sz]ed?\s*to\s*work|work\s*authori[sz]ation/i],
  ["can_relocate", /relocat/i],
  ["can_work_in_person", /work\s*(in person|on.?site)|on.?site/i],
  ["can_start_immediately", /start\s*immediately/i],
  ["education_institution", /university|college|institution|school/i],
  ["education_qualification", /degree|qualification/i],
  ["security_clearance", /security\s*clearance|clearance\s*level/i],
  ["limited_company_name", /limited\s*company|company\s*name/i],
  ["location", /current\s*location|where\s*are\s*you\s*based/i],
];

const SENSITIVE = /(date of birth|birth date|national insurance|passport|social security|gender|sex|ethnic|race|religion|disab|medical|health|veteran|criminal|conviction|salary expectation|current salary|signature|terms and conditions|privacy consent|background check)/i;

function fieldText(field: RunnerField): string {
  return `${field.label} ${field.name} ${field.placeholder}`.replace(/\s+/g, " ").trim();
}

export function deterministicMapping(field: RunnerField): FieldMapping | null {
  const text = fieldText(field);
  if (SENSITIVE.test(text) || field.type === "password") return { fieldId: field.id, factKey: "needs_user" };
  const matched = PATTERNS.find(([, pattern]) => pattern.test(text));
  return matched ? { fieldId: field.id, factKey: matched[0] } : null;
}

function normalise(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function screeningAnswer(field: RunnerField, facts: RunnerFacts): string {
  const label = normalise(field.label || field.name || field.placeholder);
  if (!label) return "";
  const exact = facts.screeningAnswers.find((question) => normalise(question.label) === label && question.reviewed);
  if (exact?.answer.trim()) return exact.answer.trim();
  const near = facts.screeningAnswers.find((question) => {
    if (!question.reviewed || !question.answer.trim()) return false;
    const candidate = normalise(question.label);
    return candidate.length >= 12 && (candidate.includes(label) || label.includes(candidate));
  });
  return near?.answer.trim() ?? "";
}

export function valueForMapping(mapping: FieldMapping, facts: RunnerFacts): string {
  if (!FACT_KEYS.includes(mapping.factKey as FactKey)) return "";
  return facts.values[mapping.factKey as FactKey]?.trim() ?? "";
}

export function closestOption(value: string, options: string[]): string {
  if (!value || options.length === 0) return "";
  const target = normalise(value);
  const exact = options.find((option) => normalise(option) === target);
  if (exact) return exact;
  if (target === "yes") return options.find((option) => /^(yes|true|authori[sz]ed|i agree)$/i.test(option.trim())) ?? "";
  if (target === "no") return options.find((option) => /^(no|false|not required|i do not agree)$/i.test(option.trim())) ?? "";
  return options.find((option) => normalise(option).includes(target) || target.includes(normalise(option))) ?? "";
}
