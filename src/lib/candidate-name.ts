import { isPlausibleCandidateName, normaliseExtractedCvText, resolveCvCandidateName } from "@/lib/resume/identity";
const CLOSING_LINE = /^(?:kind regards|best regards|regards|sincerely|yours sincerely|yours faithfully)\s*,?\s*(?:[\p{L}][\p{L}'’.\-]*(?:\s+[\p{L}][\p{L}'’.\-]*){0,5})?$/iu;

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

/** Uses the saved profile first, then a plausible personal name near the top of the Resume. */
export function resolveCandidateName(profileName: string, cvText: string): string | null {
  const cvName = normaliseExtractedCvText(cvText)
    .split("\n")
    .slice(0, 10)
    .map(cleanName)
    .find(isPlausibleCandidateName);
  const resolved = resolveCvCandidateName(profileName, cvName ?? "");
  return resolved === "Candidate" ? null : resolved;
}

/** Removes one or more trailing signatures from a reusable cover letter. */
export function stripCoverLetterSignoff(letter: string): string {
  let lines = letter.replace(/\r\n?/g, "\n").split("\n");

  while (lines.length) {
    while (lines.length && !lines.at(-1)?.trim()) lines.pop();
    const searchFrom = Math.max(0, lines.length - 4);
    let closingIndex = -1;
    for (let index = lines.length - 1; index >= searchFrom; index -= 1) {
      if (CLOSING_LINE.test(lines[index].trim())) {
        closingIndex = index;
        break;
      }
    }
    if (closingIndex < 0) break;
    lines = lines.slice(0, closingIndex);
  }

  return lines.join("\n").trim();
}

/** Keeps the customer-facing term consistent across old and new letters. */
export function normaliseCoverLetterTerminology(letter: string): string {
  return letter
    .replace(/\bcurriculum vitae\b/gi, "Resume")
    .replace(/\bcv\b/gi, "Resume");
}

/** Ensures a generated or previously saved letter is signed once by the real applicant. */
export function normaliseCoverLetterSignoff(letter: string, candidateName: string): string {
  const body = normaliseCoverLetterTerminology(stripCoverLetterSignoff(letter));
  const name = cleanName(candidateName);
  if (!body || !name) return body;
  return `${body}\n\nKind regards,\n${name}`;
}
