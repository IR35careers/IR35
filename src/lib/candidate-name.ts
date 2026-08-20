const GENERIC_NAME = /^(contractor|candidate|applicant|cv|resume|curriculum vitae|profile|professional profile|summary|professional summary|skills|experience|employment|career history)$/i;
const ROLE_WORD = /^(engineer|developer|manager|consultant|contractor|analyst|architect|specialist|director|officer|lead)$/i;

function cleanName(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function nameParts(value: string): string[] | null {
  const name = cleanName(value);
  if (!name || GENERIC_NAME.test(name) || /[@|:/\\]|https?:|www\.|linkedin|\d{2,}/i.test(name)) return null;
  const parts = name.split(/\s+/);
  if (parts.length < 2 || parts.length > 6 || parts.some((part) => !/^[\p{L}][\p{L}'’.\-]*$/u.test(part)) || parts.some((part) => ROLE_WORD.test(part))) return null;
  return parts;
}

function looksLikeCvName(value: string): boolean {
  const parts = nameParts(value);
  if (!parts) return false;
  return parts.filter((part) => /^\p{Lu}/u.test(part)).length >= 2;
}

/** Uses the saved profile first, then a plausible personal name near the top of the CV. */
export function resolveCandidateName(profileName: string, cvText: string): string | null {
  const supplied = cleanName(profileName);
  if (nameParts(supplied)) return supplied;
  const cvName = cvText
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .slice(0, 10)
    .map(cleanName)
    .find(looksLikeCvName);
  return cvName ?? null;
}

/** Ensures a generated or previously saved letter is signed by the real applicant. */
export function normaliseCoverLetterSignoff(letter: string, candidateName: string): string {
  const body = letter.trim();
  if (!body) return body;
  const closingName = /(Kind regards|Best regards|Regards|Sincerely|Yours sincerely|Yours faithfully),?\s*\n\s*[^\n]{1,100}\s*$/i;
  const closingOnly = /(Kind regards|Best regards|Regards|Sincerely|Yours sincerely|Yours faithfully),?\s*$/i;
  if (closingName.test(body)) return body.replace(closingName, `$1,\n${candidateName}`);
  if (closingOnly.test(body)) return `${body}\n${candidateName}`;
  return `${body}\n\nKind regards,\n${candidateName}`;
}
