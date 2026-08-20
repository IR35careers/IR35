const SECURITY_TEXT = `Contact: https://www.ir35careers.com/contact
Expires: 2027-08-20T23:59:59.000Z
Preferred-Languages: en
Canonical: https://www.ir35careers.com/.well-known/security.txt
Policy: https://www.ir35careers.com/bug-bounty
`;

export function GET(): Response {
  return new Response(SECURITY_TEXT, {
    headers: {
      "Cache-Control": "public, max-age=86400, stale-while-revalidate=86400",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
