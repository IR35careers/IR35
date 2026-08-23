const CONTEXT =
  /verification|verify|security code|one.?time|otp|confirm(?:ation)?.{0,20}email/i;

const RESERVED = new Set([
  "EMAIL",
  "HTTPS",
  "LOGIN",
  "SECURITY",
  "VERIFY",
]);

export function extractEmailVerificationCode(
  subject: string,
  body: string,
): string | null {
  const text = `${subject}\n${body}`
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 20_000);
  if (!CONTEXT.test(text)) return null;

  const candidates = [
    text.match(
      /(?:verification|security|one.?time|otp)(?:\s+code)?(?:\s+(?:is|use|enter))?[^a-z0-9]{0,12}([A-Z0-9]{4,8})\b/i,
    )?.[1],
    text.match(
      /\bcode(?:\s+(?:is|use|enter))?[^a-z0-9]{0,12}([A-Z0-9]{4,8})\b/i,
    )?.[1],
    text.match(
      /\b([A-Z0-9]{4,8})\b[^a-z0-9]{0,12}(?:is\s+)?(?:your\s+)?(?:verification|security|one.?time|otp)(?:\s+code)?/i,
    )?.[1],
  ];
  return (
    candidates.find(
      (candidate): candidate is string =>
        Boolean(
          candidate &&
            !RESERVED.has(candidate.toUpperCase()) &&
            /\d/.test(candidate),
        ),
    ) ?? null
  );
}
