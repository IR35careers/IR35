import { getCompanyLogoDomain } from "@/lib/company-brand";

const MAX_COMPANY_NAME_LENGTH = 120;
const LOGO_SIZE = 128;
const CACHE_SECONDS = 60 * 60 * 24 * 7;

function unavailable(): Response {
  return new Response(null, {
    status: 404,
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=3600",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const company = new URL(request.url).searchParams.get("company")?.trim().slice(0, MAX_COMPANY_NAME_LENGTH) ?? "";
  const domain = getCompanyLogoDomain(company);
  if (!domain) return unavailable();

  const providerUrl = new URL("https://www.google.com/s2/favicons");
  providerUrl.searchParams.set("domain_url", `https://${domain}`);
  providerUrl.searchParams.set("sz", String(LOGO_SIZE));

  try {
    const response = await fetch(providerUrl, {
      cache: "force-cache",
      next: { revalidate: CACHE_SECONDS },
      signal: AbortSignal.timeout(4_000),
      headers: { Accept: "image/avif,image/webp,image/png,image/*" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok || !contentType.startsWith("image/")) return unavailable();

    return new Response(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "Cache-Control": `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS * 4}, stale-while-revalidate=${CACHE_SECONDS}`,
        "Content-Type": contentType,
        "Content-Security-Policy": "default-src 'none'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return unavailable();
  }
}

