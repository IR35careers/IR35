import type { JobDetail } from "@/lib/job-types";
import type {
  ParsedResume,
  ResumeAnalysis,
  ResumeScore,
  ResumeSection,
  ResumeSectionKind,
  ResumeSuggestion,
  RoleKeyword,
} from "@/lib/resume/types";
import { normaliseResumeText } from "@/lib/resume/normalise-text";

const HEADING_KINDS: Array<[RegExp, ResumeSectionKind]> = [
  [/^(profile|professional profile|summary|professional summary|about me)$/i, "summary"],
  [/^(skills|technical skills|core skills|core competencies|expertise)$/i, "skills"],
  [/^(experience|professional experience|employment|career history|work history)$/i, "experience"],
  [/^(education|qualifications|academic background)$/i, "education"],
  [/^(certifications?|accreditations?)$/i, "certifications"],
  [/^(projects?|selected projects?)$/i, "projects"],
];

const ROLE_TERMS = [
  "Accessibility",
  "Agile",
  "API",
  "AWS",
  "Azure",
  "Business Analysis",
  "C#",
  "Change Management",
  "CI/CD",
  "Cloud",
  "Cyber Security",
  "Data Engineering",
  "DevOps",
  "Docker",
  "Dynamics 365",
  "GCP",
  "Git",
  "Governance",
  "GRC",
  "Java",
  "JavaScript",
  "Kubernetes",
  "Machine Learning",
  "Next.js",
  "Node.js",
  "Platform reliability",
  "PostgreSQL",
  "Power BI",
  "Product Management",
  "Programme Management",
  "Project Management",
  "Python",
  "QA",
  "React",
  "Risk Management",
  "SAP",
  "SC Cleared",
  "ServiceNow",
  "Solutions Architecture",
  "SQL",
  "Stakeholder Management",
  "Terraform",
  "Testing",
  "TypeScript",
] as const;

const TERM_ALIASES: Record<string, string[]> = {
  "amazon web services": ["aws", "amazon web services"],
  aws: ["aws", "amazon web services"],
  azure: ["azure", "microsoft azure"],
  "c#": ["c#", "c sharp"],
  "ci/cd": ["ci/cd", "ci cd", "continuous integration", "continuous delivery"],
  devops: ["devops", "dev ops"],
  gcp: ["gcp", "google cloud", "google cloud platform"],
  nextjs: ["nextjs", "next js", "next.js"],
  "next.js": ["nextjs", "next js", "next.js"],
  nodejs: ["nodejs", "node js", "node.js"],
  "node.js": ["nodejs", "node js", "node.js"],
  qa: ["qa", "quality assurance"],
  "sc cleared": ["sc cleared", "security clearance", "security cleared"],
  typescript: ["typescript", "type script"],
};

const ACTION_VERBS = [
  "achieved",
  "analysed",
  "architected",
  "built",
  "configured",
  "coordinated",
  "created",
  "delivered",
  "designed",
  "developed",
  "implemented",
  "improved",
  "led",
  "managed",
  "migrated",
  "optimised",
  "owned",
  "reduced",
  "supported",
  "tested",
];

const TITLE_STOP_WORDS = new Set([
  "and",
  "contract",
  "contractor",
  "engineer",
  "lead",
  "manager",
  "outside",
  "inside",
  "ir35",
  "senior",
  "technical",
  "the",
]);

const NAME_BLOCKLIST = /\b(curriculum|vitae|resume|profile|summary|engineer|developer|architect|analyst|manager|consultant|specialist|scientist|designer|administrator|director|lead|officer|contractor|platform|reliability|devops)\b/i;

function clamp(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function cleanLine(line: string): string {
  return line.replace(/^\s*[•*-]\s*/, "").replace(/\s+/g, " ").trim();
}

function normaliseForMatch(value: string): string {
  return ` ${value
    .toLocaleLowerCase("en-GB")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9+#]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()} `;
}

function aliasesFor(term: string): string[] {
  const key = term.toLocaleLowerCase("en-GB");
  return TERM_ALIASES[key] ?? [term];
}

export function resumeContainsTerm(text: string, term: string): boolean {
  const haystack = normaliseForMatch(text);
  return aliasesFor(term).some((alias) => haystack.includes(normaliseForMatch(alias)));
}

function sectionKind(title: string): ResumeSectionKind | null {
  for (const [pattern, kind] of HEADING_KINDS) {
    if (pattern.test(title.trim())) return kind;
  }
  return null;
}

function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > 42) return false;
  if (sectionKind(trimmed)) return true;
  return /^[A-Z][A-Z &/+-]{2,}$/.test(trimmed);
}

function findCandidateName(lines: string[], contactIndex: number): string {
  const candidates = lines.slice(0, 20).flatMap((raw, index) => {
    const line = raw.trim();
    const words = line.split(/\s+/).filter(Boolean);
    if (
      words.length < 2 ||
      words.length > 5 ||
      line.length > 60 ||
      /@|linkedin|https?:|www\.|\+?\d[\d ()-]{7,}/i.test(line) ||
      sectionKind(line) ||
      NAME_BLOCKLIST.test(line) ||
      !/^[\p{L}][\p{L}'’-]*(?:\s+[\p{L}][\p{L}'’-]*)+$/u.test(line)
    ) return [];

    let score = words.length <= 3 ? 5 : 2;
    if (index <= 5) score += 4;
    if (contactIndex >= 0 && index < contactIndex && contactIndex - index <= 4) score += 3;
    if (words.every((word) => /^\p{Lu}[\p{L}'’-]*$/u.test(word) || /^\p{Lu}+$/u.test(word))) score += 2;
    return [{ line, index, score }];
  });

  return candidates.sort((left, right) => right.score - left.score || left.index - right.index)[0]?.line ?? "Candidate";
}

export function parseResumeText(rawText: string, filename = "Pasted Resume"): ParsedResume {
  const text = normaliseResumeText(rawText)
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
  const lines = text.split("\n");
  const nonEmpty = lines.map((line) => line.trim()).filter(Boolean);
  const contactIndex = nonEmpty.slice(0, 20).findIndex((line) => /@|linkedin|\+?\d[\d ()-]{7,}/i.test(line));
  const contactLine = contactIndex >= 0 ? nonEmpty[contactIndex] : "";
  const candidateName = findCandidateName(nonEmpty, contactIndex);

  const sections: ResumeSection[] = [];
  let currentTitle = "Profile";
  let currentKind: ResumeSectionKind = "other";
  let bucket: string[] = [];

  const flush = () => {
    const content = bucket.join("\n").trim();
    if (content) sections.push({ kind: currentKind, title: currentTitle, content });
    bucket = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const isIdentityLine = trimmed.toLocaleLowerCase("en-GB") === candidateName.toLocaleLowerCase("en-GB");
    if (!isIdentityLine && looksLikeHeading(trimmed)) {
      flush();
      currentTitle = trimmed;
      currentKind = sectionKind(trimmed) ?? "other";
      continue;
    }
    bucket.push(line);
  }
  flush();

  if (sections.length === 0 && text) {
    sections.push({ kind: "other", title: "Resume", content: text });
  }

  return { filename, rawText: text, candidateName, contactLine, sections };
}

export function extractRoleKeywords(job: Pick<JobDetail, "skills" | "description">): RoleKeyword[] {
  const found = new Map<string, RoleKeyword>();
  const add = (term: string, source: RoleKeyword["source"], weight: number) => {
    const key = term.toLocaleLowerCase("en-GB");
    const existing = found.get(key);
    if (!existing || existing.weight < weight) found.set(key, { term, source, weight });
  };

  for (const skill of job.skills) add(skill, "listed-skill", 3);
  for (const term of ROLE_TERMS) {
    if (resumeContainsTerm(job.description, term)) add(term, "job-description", 1);
  }

  return [...found.values()].sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term)).slice(0, 18);
}

function keywordEvidenceScore(text: string, matchedKeywords: string[]): number {
  if (matchedKeywords.length === 0) return 0;
  const lines = text.split(/\n+/).map(cleanLine).filter(Boolean);
  const scores = matchedKeywords.map((keyword) => {
    const evidenceLines = lines.filter((line) => resumeContainsTerm(line, keyword));
    if (evidenceLines.length === 0) return 0;
    const hasAction = evidenceLines.some((line) => ACTION_VERBS.some((verb) => normaliseForMatch(line).includes(` ${verb} `)));
    const hasMeasure = evidenceLines.some((line) => /\b\d+(?:[.,]\d+)?%?\b|£|\$|€/.test(line));
    return 40 + (hasAction ? 35 : 0) + (hasMeasure ? 25 : 0);
  });
  return clamp(scores.reduce((sum, score) => sum + score, 0) / scores.length);
}

function readabilityScore(parsed: ParsedResume): number {
  const text = parsed.rawText;
  const words = text.split(/\s+/).filter(Boolean).length;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const headingCount = parsed.sections.filter((section) => section.kind !== "other").length;
  const bulletCount = lines.filter((line) => /^\s*[•*-]\s+/.test(line)).length;
  const contactSignals = Number(/@/.test(text)) + Number(/linkedin/i.test(text)) + Number(/\+?\d[\d ()-]{7,}/.test(text));
  const veryLongLines = lines.filter((line) => line.length > 220).length;

  const structure = Math.min(30, headingCount * 8);
  const bullets = Math.min(25, bulletCount * 4);
  const length = words >= 250 && words <= 1200 ? 25 : words >= 120 && words <= 1600 ? 16 : 8;
  const contact = Math.min(15, contactSignals * 5);
  const lineQuality = veryLongLines === 0 ? 5 : Math.max(0, 5 - veryLongLines);
  return clamp(structure + bullets + length + contact + lineQuality);
}

function roleRelevanceScore(text: string, jobTitle: string, keywordCoverage: number): number {
  const titleTokens = normaliseForMatch(jobTitle)
    .trim()
    .split(" ")
    .filter((token) => token.length > 2 && !TITLE_STOP_WORDS.has(token));
  const titleMatches = titleTokens.filter((token) => normaliseForMatch(text).includes(` ${token} `)).length;
  const titleScore = titleTokens.length === 0 ? 70 : (titleMatches / titleTokens.length) * 100;
  return clamp(keywordCoverage * 0.72 + titleScore * 0.28);
}

export function scoreResumeForRole(
  text: string,
  job: Pick<JobDetail, "title" | "description" | "skills">,
  filename = "Resume"
): ResumeScore {
  const parsed = parseResumeText(text, filename);
  const keywords = extractRoleKeywords(job);
  const matched = keywords.filter((keyword) => resumeContainsTerm(text, keyword.term));
  const missing = keywords.filter((keyword) => !resumeContainsTerm(text, keyword.term));
  const totalWeight = keywords.reduce((sum, keyword) => sum + keyword.weight, 0) || 1;
  const matchedWeight = matched.reduce((sum, keyword) => sum + keyword.weight, 0);
  const keywordCoverage = clamp((matchedWeight / totalWeight) * 100);
  const evidenceStrength = keywordEvidenceScore(text, matched.map((keyword) => keyword.term));
  const roleRelevance = roleRelevanceScore(text, job.title, keywordCoverage);
  const atsReadability = readabilityScore(parsed);
  const overall = clamp(
    keywordCoverage * 0.45 + evidenceStrength * 0.25 + roleRelevance * 0.15 + atsReadability * 0.15
  );

  return {
    overall,
    breakdown: { keywordCoverage, evidenceStrength, roleRelevance, atsReadability },
    matchedKeywords: matched.map((keyword) => keyword.term),
    missingKeywords: missing.map((keyword) => keyword.term),
  };
}

function sentenceCase(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function conservativeRewrite(line: string): string {
  const hadBullet = /^\s*[•*-]\s+/.test(line);
  const original = cleanLine(line);
  let value = original
    .replace(/^I was responsible for\s+/i, "Responsible for ")
    .replace(/^I am responsible for\s+/i, "Responsible for ")
    .replace(/^My responsibilities included\s+/i, "Responsibilities included ")
    .replace(/^I worked on\s+/i, "Worked on ")
    .replace(/^I helped (?:to|with)\s+/i, "Supported ")
    .replace(/\bin order to\b/gi, "to")
    .replace(/\s+/g, " ")
    .trim();
  if (value === original) return line;
  value = sentenceCase(value);
  if (value && !/[.!?]$/.test(value)) value += ".";
  return hadBullet ? `- ${value}` : value;
}

function makeSuggestions(
  parsed: ParsedResume,
  job: Pick<JobDetail, "title" | "description" | "skills">,
  baseline: ResumeScore
): ResumeSuggestion[] {
  const suggestions: ResumeSuggestion[] = [];
  const summary = parsed.sections.find((section) => section.kind === "summary");
  const focusTerms = baseline.matchedKeywords.slice(0, 5);

  if (focusTerms.length > 0) {
    const evidenceLine = `Experience includes ${focusTerms.join(", ")}, supported by the delivery examples in this Resume.`;
    const original = summary?.content.trim() ?? "";
    const replacement = original ? `${original.replace(/\s+$/g, "")}\n${evidenceLine}` : `PROFILE\n${evidenceLine}`;
    if (!resumeContainsTerm(original, job.title) || focusTerms.some((term) => !resumeContainsTerm(original, term))) {
      suggestions.push({
        id: "summary-role-focus",
        kind: "summary",
        title: original ? "Focus the opening profile" : "Add a role-focused profile",
        rationale: "Moves only skills already evidenced elsewhere in your Resume into the first scan area.",
        original,
        replacement,
        evidenceTerms: focusTerms,
        requiresConfirmation: false,
      });
    }
  }

  const candidateLines = parsed.rawText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length >= 24 && line.length <= 240)
    .filter((line) => baseline.matchedKeywords.some((keyword) => resumeContainsTerm(line, keyword)));

  for (const [index, line] of candidateLines.entries()) {
    if (suggestions.filter((suggestion) => suggestion.kind === "rewrite").length >= 5) break;
    const replacement = conservativeRewrite(line);
    if (replacement === line || cleanLine(replacement) === cleanLine(line)) continue;
    const evidenceTerms = baseline.matchedKeywords.filter((keyword) => resumeContainsTerm(line, keyword));
    suggestions.push({
      id: `rewrite-${index + 1}`,
      kind: "rewrite",
      title: "Tighten an evidence line",
      rationale: "Removes first-person or filler wording without changing the skill, result, employer, date or number.",
      original: line,
      replacement,
      evidenceTerms,
      requiresConfirmation: false,
    });
  }

  for (const [index, keyword] of baseline.missingKeywords.slice(0, 8).entries()) {
    const roleKeyword = extractRoleKeywords(job).find((item) => item.term === keyword);
    suggestions.push({
      id: `verified-keyword-${index + 1}-${keyword.toLocaleLowerCase("en-GB").replace(/[^a-z0-9]+/g, "-")}`,
      kind: "verified-keyword",
      title: `Verify ${keyword}`,
      rationale:
        roleKeyword?.source === "listed-skill"
          ? "This skill is explicitly listed for the role, but it is not evidenced in your Resume. Add it only if it is genuinely yours."
          : "This term appears in the role description, but not your Resume. Add it only if you can support it in an interview.",
      original: "Not found in your Resume",
      replacement: keyword,
      evidenceTerms: [],
      requiresConfirmation: true,
    });
  }

  return suggestions;
}

export function applyResumeSuggestions(
  sourceText: string,
  suggestions: ResumeSuggestion[],
  acceptedIds: Iterable<string>,
  confirmedKeywordIds: Iterable<string>
): string {
  const accepted = new Set(acceptedIds);
  const confirmed = new Set(confirmedKeywordIds);
  let result = sourceText.trim();
  const verifiedKeywords: string[] = [];

  for (const suggestion of suggestions) {
    if (!accepted.has(suggestion.id)) continue;
    if (suggestion.requiresConfirmation && !confirmed.has(suggestion.id)) continue;
    if (suggestion.kind === "verified-keyword") {
      if (!resumeContainsTerm(result, suggestion.replacement)) verifiedKeywords.push(suggestion.replacement);
      continue;
    }
    if (suggestion.original && result.includes(suggestion.original)) {
      result = result.replace(suggestion.original, suggestion.replacement);
    } else if (!suggestion.original) {
      result = `${suggestion.replacement}\n\n${result}`;
    }
  }

  if (verifiedKeywords.length > 0) {
    result += `\n\nVERIFIED ROLE SKILLS\n- ${verifiedKeywords.join("\n- ")}`;
  }
  return result.trim();
}

export function analyseResumeForRole(rawText: string, filename: string, job: JobDetail): ResumeAnalysis {
  const parsed = parseResumeText(rawText, filename);
  const baseline = scoreResumeForRole(parsed.rawText, job, filename);
  const suggestions = makeSuggestions(parsed, job, baseline);
  const defaultAcceptedIds = suggestions
    .filter((suggestion) => !suggestion.requiresConfirmation)
    .map((suggestion) => suggestion.id);
  const projectedText = applyResumeSuggestions(parsed.rawText, suggestions, defaultAcceptedIds, []);
  const projected = scoreResumeForRole(projectedText, job, filename);

  return {
    job: {
      id: job.id,
      title: job.title,
      company_name: job.company_name,
      description: job.description,
      skills: job.skills,
    },
    keywords: extractRoleKeywords(job),
    baseline,
    projected,
    suggestions,
    defaultAcceptedIds,
  };
}
