export type JobDescriptionKind = "source_text" | "summary" | "limited" | "missing";

export function isTruncatedJobDescription(description: string): boolean {
  return /(?:…|\.{3})\s*$/.test(description.trim());
}

/** Import safety cap, not a UI excerpt. Never retain half of a source word. */
export function limitImportedJobDescription(text: string, maximum = 100_000) {
  if (!Number.isSafeInteger(maximum) || maximum < 2 || maximum > 100_000) throw new Error("Invalid job description limit.");
  if (text.length <= maximum) return { text, limited: false };
  const head = text.slice(0, maximum - 1);
  // A following whitespace character proves the whole final word fits. Otherwise
  // step back to a complete word (possibly all the way to an empty excerpt).
  const boundary = /\s/.test(text[maximum - 1]) ? head.length : head.search(/\s+\S*$/);
  const complete = (boundary < 0 ? "" : head.slice(0, boundary)).trimEnd();
  return { text: complete ? `${complete}…` : "", limited: true };
}

export function jobDescriptionKind(description: string, suppliedKind?: JobDescriptionKind): JobDescriptionKind {
  if (suppliedKind === "limited") return "limited";
  if (!description.trim() || suppliedKind === "missing" || /^(?:The source did not (?:expose|provide) a readable (?:job )?description|The full contract description is available from the original posting|Full details are on the original listing)[.!]/i.test(description.trim())) return "missing";
  if (suppliedKind === "summary" || isTruncatedJobDescription(description)) return "summary";
  return "source_text";
}

/** A browser link only, never server navigation or proof that a host is public. */
export function jobDescriptionSourceUrl(value?: string): string | null {
  if (!value || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password) return null;
    return url.href;
  } catch { return null; }
}
