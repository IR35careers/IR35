import {
  FACT_KEYS,
  type FactKey,
  type FieldMapping,
  type RunnerFacts,
  type RunnerField,
} from "@/lib/application-runner/types";

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
  [
    "right_to_work",
    /right\s*to\s*work|authori[sz]ed?\s*to\s*work|work\s*authori[sz]ation/i,
  ],
  ["can_relocate", /relocat/i],
  ["can_work_in_person", /work\s*(in person|on.?site)|on.?site/i],
  ["can_start_immediately", /start\s*immediately/i],
  ["education_institution", /university|college|institution|school/i],
  ["education_qualification", /degree|qualification/i],
  ["security_clearance", /security\s*clearance|clearance\s*level/i],
  ["limited_company_name", /limited\s*company|company\s*name/i],
  ["is_over_18", /(?:18|eighteen).*(?:older|over)|age.*(?:eligib|confirm)/i],
  [
    "has_transportation",
    /reliable\s*transport|own\s*transport|driving\s*licen[cs]e/i,
  ],
  [
    "needs_accommodation",
    /accommodation|workplace\s*adjustment|reasonable\s*adjustment/i,
  ],
  [
    "worked_for_company_before",
    /worked.*(?:company|us).*before|previously\s*(?:employed|worked)/i,
  ],
  ["has_government_clearance", /hold.*(?:government|security)\s*clearance/i],
  ["has_government_ties", /government.*(?:ties|employment|contract)/i],
  ["willing_to_travel", /willing.*travel|travel.*required/i],
  ["willing_to_work_shifts", /willing.*shift|shift\s*work/i],
  ["willing_to_work_weekends", /willing.*weekend|weekend\s*work/i],
  ["background_check_consent", /background\s*check|pre-employment\s*screen/i],
  ["criminal_convictions", /criminal|conviction/i],
  [
    "target_day_rate",
    /(?:expected|target|desired).*(?:day\s*rate|rate)|day\s*rate/i,
  ],
  [
    "target_annual_salary",
    /(?:expected|target|desired).*(?:annual\s*)?salary|salary\s*expectation/i,
  ],
  ["years_of_experience", /years?.*(?:experience|using|working)/i],
  ["referral_source", /how.*(?:hear|find).*(?:role|job|opportun)|source/i],
  ["location", /current\s*location|where\s*are\s*you\s*based/i],
];

const SENSITIVE =
  /(date of birth|birth date|national insurance|passport|social security|gender|sex|ethnic|race|religion|medical|health|veteran|current salary|signature|terms and conditions|privacy consent)/i;

function fieldText(field: RunnerField): string {
  return `${field.label} ${field.name} ${field.placeholder}`
    .replace(/\s+/g, " ")
    .trim();
}

export function deterministicMapping(field: RunnerField): FieldMapping | null {
  const text = fieldText(field);
  if (SENSITIVE.test(text) || field.type === "password")
    return { fieldId: field.id, factKey: "needs_user" };
  const matched = PATTERNS.find(([, pattern]) => pattern.test(text));
  return matched ? { fieldId: field.id, factKey: matched[0] } : null;
}

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function screeningAnswer(
  field: RunnerField,
  facts: RunnerFacts,
): string {
  const label = normalise(field.label || field.name || field.placeholder);
  if (!label) return "";
  const exact = facts.screeningAnswers.find(
    (question) => normalise(question.label) === label && question.reviewed,
  );
  if (exact?.answer.trim()) return exact.answer.trim();
  const near = facts.screeningAnswers.find((question) => {
    if (!question.reviewed || !question.answer.trim()) return false;
    const candidate = normalise(question.label);
    return (
      candidate.length >= 12 &&
      (candidate.includes(label) || label.includes(candidate))
    );
  });
  return near?.answer.trim() ?? "";
}

export function valueForMapping(
  mapping: FieldMapping,
  facts: RunnerFacts,
): string {
  if (!FACT_KEYS.includes(mapping.factKey as FactKey)) return "";
  return facts.values[mapping.factKey as FactKey]?.trim() ?? "";
}

export function closestOption(value: string, options: string[]): string {
  if (!value || options.length === 0) return "";
  const target = normalise(value);
  const exact = options.find((option) => normalise(option) === target);
  if (exact) return exact;
  if (target === "yes")
    return (
      options.find((option) =>
        /^(yes|true|authori[sz]ed|i agree)$/i.test(option.trim()),
      ) ?? ""
    );
  if (target === "no")
    return (
      options.find((option) =>
        /^(no|false|not required|i do not agree)$/i.test(option.trim()),
      ) ?? ""
    );
  return (
    options.find(
      (option) =>
        normalise(option).includes(target) ||
        target.includes(normalise(option)),
    ) ?? ""
  );
}
