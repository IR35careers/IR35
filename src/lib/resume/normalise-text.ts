const EMPTY_BULLET_LINE = /^\s*(?:[•●◦▪‣·*-]\s*)+$/;

/**
 * Keeps CV text readable without changing its wording. Empty bullet markers
 * can be introduced by document extraction or model formatting; they carry no
 * candidate evidence and should never reach review, storage or export.
 */
export function normaliseResumeText(value: string): string {
  const cleaned: string[] = [];
  for (const rawLine of value.replace(/\r\n?/g, "\n").split("\n")) {
    const line = EMPTY_BULLET_LINE.test(rawLine)
      ? ""
      : rawLine.replace(/[ \t]+$/g, "");
    if (!line.trim() && !cleaned.at(-1)?.trim()) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").trim();
}
