import type { SupabaseClient } from "@supabase/supabase-js";

const ACTION_CONTEXT =
  /verify|verification|confirm|confirmation|activate|activation|magic\s+link|sign[ -]?in\s+link|log[ -]?in\s+link|reset|recover|recovery|password/i;
const ACTION_URL =
  /verify|confirm|activate|magic|signin|sign-in|login|log-in|reset|recover|recovery|password|token|auth/i;
const REJECTED_URL =
  /unsubscribe|privacy|terms(?:-of-(?:use|service))?|cookie|preferences|view-in-browser|open-tracking|click-tracking/i;

function recipientApplicationId(value: string): string | undefined {
  const match = value
    .trim()
    .toLowerCase()
    .match(/-a([0-9a-f]{32})@[a-z0-9.-]+$/);
  const compact = match?.[1];
  return compact
    ? `${compact.slice(0, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}-${compact.slice(20)}`
    : undefined;
}

function recipientMatches(actualValue: string, expectedValue: string | undefined, applicationId: string): boolean {
  const actual = actualValue.trim().toLowerCase();
  const expected = expectedValue?.trim().toLowerCase();
  if (!expected || actual === expected) return true;
  const actualApplicationId = recipientApplicationId(actual);
  const expectedBase = expected.replace(/-a[0-9a-f]{32}(?=@)/, "");
  const actualBase = actual.replace(/-a[0-9a-f]{32}(?=@)/, "");
  return actualApplicationId === applicationId && actualBase === expectedBase;
}

function safeHttpsUrl(value: string): string | null {
  try {
    const decoded = value
      .replace(/&amp;/gi, "&")
      .replace(/&#x3d;/gi, "=")
      .replace(/&#61;/gi, "=")
      .trim();
    const url = new URL(decoded);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.toString().length > 2_048 ||
      REJECTED_URL.test(`${url.hostname}${url.pathname}`)
    )
      return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * Keeps only account-action links from employer email HTML. The resulting
 * URLs are stored with the plain-text message so the background runner can
 * resume after a password reset, verification link or magic-link sign-in.
 */
export function extractEmailActionLinksFromHtml(html: string): string[] {
  if (!ACTION_CONTEXT.test(html)) return [];
  const links: string[] = [];
  const anchors = html.matchAll(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi,
  );
  for (const match of anchors) {
    const href = match[1] ?? match[2] ?? match[3] ?? "";
    const label = (match[4] ?? "").replace(/<[^>]+>/g, " ");
    const url = safeHttpsUrl(href);
    if (!url || (!ACTION_CONTEXT.test(label) && !ACTION_URL.test(url)))
      continue;
    if (!links.includes(url)) links.push(url);
    if (links.length >= 8) break;
  }
  return links;
}

export function appendEmailActionLinks(text: string, html: string): string {
  const links = extractEmailActionLinksFromHtml(html);
  if (!links.length) return text;
  const missing = links.filter((link) => !text.includes(link));
  if (!missing.length) return text;
  return `${text}\n\nSecure employer action link${missing.length > 1 ? "s" : ""}:\n${missing.join("\n")}`
    .trim()
    .slice(0, 100_000);
}

/** Selects the strongest account-action URL from a normalised email. */
export function extractEmailActionLink(
  subject: string,
  body: string,
): string | null {
  const context = `${subject}\n${body}`.slice(0, 100_000);
  if (!ACTION_CONTEXT.test(context)) return null;
  const candidates = context.match(/https:\/\/[^\s<>"']{8,2048}/gi) ?? [];
  const scored = candidates
    .map((candidate) => safeHttpsUrl(candidate.replace(/[),.;]+$/, "")))
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => ({
      candidate,
      score:
        (ACTION_URL.test(candidate) ? 4 : 0) +
        (/token|code|key|ticket|secret/i.test(new URL(candidate).search) ? 3 : 0) +
        (/reset|recover|password/i.test(subject) ? 2 : 0) +
        (/verify|confirm|activate/i.test(subject) ? 2 : 0),
    }))
    .filter(({ score }) => score >= 3)
    .sort((left, right) => right.score - left.score);
  return scored[0]?.candidate ?? null;
}

export async function waitForEmailActionLink(input: {
  admin: SupabaseClient;
  userId: string;
  applicationId: string;
  alias?: string;
  requestedAfter: string;
  attempts?: number;
  intervalMs?: number;
}): Promise<string | null> {
  const attempts = Math.max(1, Math.min(input.attempts ?? 12, 40));
  const intervalMs = Math.max(250, Math.min(input.intervalMs ?? 3_000, 10_000));
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const { data, error } = await input.admin
      .from("inbox_messages")
      .select("application_id, recipient, subject, body_text, received_at")
      .eq("user_id", input.userId)
      .gte("received_at", input.requestedAfter)
      .order("received_at", { ascending: false })
      .limit(30);
    if (error) return null;
    for (const row of data ?? []) {
      if (
        !recipientMatches(
          String(row.recipient ?? ""),
          input.alias,
          input.applicationId,
        )
      )
        continue;
      const recipientId = recipientApplicationId(String(row.recipient ?? ""));
      if (recipientId && recipientId !== input.applicationId)
        continue;
      if (
        row.application_id &&
        String(row.application_id) !== input.applicationId
      )
        continue;
      const actionLink = extractEmailActionLink(
        String(row.subject ?? ""),
        String(row.body_text ?? ""),
      );
      if (actionLink) return actionLink;
    }
    if (attempt < attempts - 1)
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}
