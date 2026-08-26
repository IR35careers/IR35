export type EmailDisplayInline =
  | { kind: "text"; value: string }
  | { kind: "link"; href: string; label: string };

export type EmailDisplayBlock =
  | { kind: "paragraph"; content: EmailDisplayInline[] }
  | { kind: "image"; src: string; alt: string };

const INLINE_CONTENT_PATTERN =
  /!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|\[(https?:\/\/[^\]]+)\]|(https?:\/\/[^\s<>\]]+)/gi;

function safeHttpUrl(value: string): string | null {
  const candidate = value.trim().replace(/[.,;:!?]+$/, "");
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

function isImageUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return /\.(?:avif|gif|jpe?g|png|svg|webp)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function friendlyLinkLabel(value: string): string {
  try {
    const host = new URL(value).hostname.replace(/^www\./i, "");
    return `Open ${host}`;
  } catch {
    return "Open link";
  }
}

function inlineContent(value: string): EmailDisplayInline[] {
  const content: EmailDisplayInline[] = [];
  let cursor = 0;

  for (const match of value.matchAll(INLINE_CONTENT_PATTERN)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      content.push({ kind: "text", value: value.slice(cursor, index) });
    }

    const rawUrl = match[2] ?? match[4] ?? match[5] ?? match[6] ?? "";
    const trailingPunctuation = rawUrl.match(/[.,;:!?]+$/)?.[0] ?? "";
    const href = safeHttpUrl(rawUrl);
    if (!href) {
      content.push({ kind: "text", value: match[0] });
    } else if (match[1] !== undefined && isImageUrl(href)) {
      content.push({
        kind: "link",
        href,
        label: match[1].trim() || "View image",
      });
    } else {
      const suppliedLabel = (match[3] ?? "").trim();
      content.push({
        kind: "link",
        href,
        label:
          suppliedLabel && !/^https?:\/\//i.test(suppliedLabel)
            ? suppliedLabel
            : friendlyLinkLabel(href),
      });
    }
    if (href && trailingPunctuation) {
      content.push({ kind: "text", value: trailingPunctuation });
    }
    cursor = index + match[0].length;
  }

  if (cursor < value.length) {
    content.push({ kind: "text", value: value.slice(cursor) });
  }

  return content.length > 0 ? content : [{ kind: "text", value }];
}

function standaloneUrl(value: string): string | null {
  const markdownImage = value.match(/^!\[[^\]]*\]\((https?:\/\/[^)\s]+)\)$/i);
  if (markdownImage) return safeHttpUrl(markdownImage[1]);
  const bracketed = value.match(/^\[(https?:\/\/[^\]]+)\]$/i);
  if (bracketed) return safeHttpUrl(bracketed[1]);
  return null;
}

function standaloneImageAlt(value: string): string {
  return value.match(/^!\[([^\]]*)\]\(/i)?.[1]?.trim() ?? "";
}

function isLikelyImageLabel(value: string): boolean {
  const trimmed = value.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= 100 &&
    !/[.!?]$/.test(trimmed) &&
    !/^https?:\/\//i.test(trimmed)
  );
}

/**
 * Converts a safely stored plain-text email into presentation-only blocks.
 * It recognises common text-email link and image conventions without parsing
 * or executing sender-controlled HTML.
 */
export function parseEmailDisplayContent(body: string): EmailDisplayBlock[] {
  const blocks: EmailDisplayBlock[] = [];
  const paragraphLines: string[] = [];
  const lines = body.replace(/\r\n?/g, "\n").split("\n");

  const flushParagraph = () => {
    const value = paragraphLines.join("\n").trim();
    paragraphLines.length = 0;
    if (value) blocks.push({ kind: "paragraph", content: inlineContent(value) });
  };

  for (const originalLine of lines) {
    const line = originalLine.trim();
    if (!line) {
      flushParagraph();
      continue;
    }

    const url = standaloneUrl(line);
    if (url && isImageUrl(url)) {
      let alt = standaloneImageAlt(line);
      if (!alt && paragraphLines.length === 1 && isLikelyImageLabel(paragraphLines[0])) {
        alt = paragraphLines.pop()?.trim() ?? "";
      }
      flushParagraph();
      blocks.push({ kind: "image", src: url, alt: alt || "Email image" });
      continue;
    }

    if (url) {
      flushParagraph();
      blocks.push({
        kind: "paragraph",
        content: [{ kind: "link", href: url, label: friendlyLinkLabel(url) }],
      });
      continue;
    }

    paragraphLines.push(originalLine.trimEnd());
  }

  flushParagraph();
  return blocks;
}

export function emailMessagePreview(value: string): string {
  const preview = parseEmailDisplayContent(value)
    .filter(
      (block): block is Extract<EmailDisplayBlock, { kind: "paragraph" }> =>
        block.kind === "paragraph",
    )
    .flatMap((block) =>
      block.content.map((item) =>
        item.kind === "text" ? item.value : item.label,
      ),
    )
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return preview.slice(0, 220);
}
