# Public SEO and feed-quality remediation — 15 October 2026

Application release: `0df1489` (preceded by `fb9fba6`, `eb32945`, `60d3322` and `4bf75c3`).
Production deployment: https://ir-35-8xenk1omw-ir-35-t.vercel.app

## Implemented

- Individual, active job pages emit escaped, nonce-bearing JobPosting JSON-LD when an original posting date and a non-truncated description are available. Demo listings and incomplete provider summaries are excluded. No invented pay, expiry, employer logo or direct-apply claim.
- Reed's official per-job API can provide missing full descriptions on cold detail reads; requests have a 2.5-second timeout and results use the public data cache. Provider summaries have a visible explanation and an original-posting link.
- Public pages have route-specific canonical URLs and social metadata. The checker, take-home calculator and job analyser have dedicated server metadata despite their client-rendered interfaces.
- Search titles are bounded to 60 characters; branding is omitted when needed. Category and blog search titles have shorter editorial templates, while visible headings retain their complete wording.
- Job descriptions in search metadata include the role, advertiser, location and actual advertised rate/status rather than the old repeated boilerplate.
- Changelog, cookies, account deletion and stories have expanded descriptions. Homepage metadata and the job analyser use British “CV”.
- Dashboard metadata explicitly prevents indexing, supplementing the existing private-route X-Robots-Tag. The jobs loading fallback no longer adds a second H1.
- Category counts, category robots directives and sitemap inclusion share the same active inventory/filter rules. Zero-result categories are noindex/follow and omitted from the sitemap; they can re-enter automatically when roles arrive.
- SAP categorisation requires a primary SAP/ERP role, not an incidental end-user mention. Supply teaching, early-years practitioners, retail sales and FLT driving are excluded alongside the existing professional-role/rate gates.
- Exact job identities can deduplicate even when a rate is missing. Historical cleanup is deliberately stricter: matching identity, description, working pattern, IR35 status and rate facts.
- Unknown pay now says “Rate not stated”. Decimal pay is parsed accurately rather than missed at its decimal point.
- Public job detail/inventory data is cached for five minutes; pipeline refreshes and repairs invalidate its tags. Sitemap refreshes use the same five-minute window and no longer have a 1,000-job ceiling or fabricate fresh modification dates for static pages.
- X-Powered-By is disabled. `/favicon.ico` contains 16/32/48-pixel icons. The brand image has descriptive alternative text; repeated decorative company icons remain hidden from assistive technology.

## Hosting/security decision

The apex Vercel domain-level redirect was removed, allowing the application's HTTPS apex redirect to send the full HSTS policy:

`max-age=63072000; includeSubDomains; preload`

Paths and query strings are preserved. HTTP still upgrades to HTTPS **on the same hostname** before the canonical www redirect. This is intentional: the [HSTS preload requirements](https://hstspreload.org/#submission-requirements) require the same-host upgrade. No preload-list submission was made.

Public HTML retains fresh CSP nonces and dynamic rendering; it is not put into a shared HTML cache. This preserves the existing strict CSP. The [Next.js CSP guide](https://nextjs.org/docs/app/guides/content-security-policy) explains why nonce-bearing pages cannot use normal static/ISR HTML caching. Data and sitemap caching are separate.

## Reversible live-data repair

The protected, signed operations route supports a preview and a hash-bound apply. A private moderation log stores original values before mutation. Jobs are expired, never hard-deleted; application records remain intact. Concurrent ingestion is guarded by original field values and source timestamps. Repair operations invalidate public data even if an operation stops part-way through.

The initial apply stopped after 61 writes; the captured error did not establish its precise cause. Its original-value audit was retained. The guard was corrected to avoid long description filters in database HTTP URLs, using a bounded source timestamp instead. The subsequent 418-write apply completed without concurrent-write skips.

Across completed repairs: 294 unsuitable/below-policy listings and 187 strict duplicates were retired, 27 incidental SAP tags corrected, and 154 advertised rates recovered (72 whole-unit, then 82 fractional). All 157 writes in the final decimal backfill completed with zero concurrent skips. Separately, a source refresh expired 250 stale records. Near-duplicates with differing descriptions still require canonical multi-source deduplication; the conservative repair intentionally does not merge uncertain matches.

## Completed database follow-up: fractional rates

Migration `supabase/migrations/023_job_rate_precision.sql` converts the original integer rate columns to `numeric(12,2)` without deleting rows. The owner confirmed execution in the Supabase SQL editor on 15 October. `JOB_DECIMAL_RATES_ENABLED=true` was then configured in production and included in deployment `0df1489`.

A new signed preview identified 82 rate corrections and 75 below-policy listings, with zero deferred fractional rates. The hash-bound apply completed all 157 writes. The following preview scanned 5,184 active records and found zero remaining repair candidates or deferred decimals.

Public readback verified job `7a37d4a7-8963-45b3-b8c9-a375fa458d71` (Design Engineer (Creo)) as GBP 35.98–35.98 **hourly**, not rounded to 36 or represented as a fictional day rate. The default-off storage compatibility guard remains for installations that have not migrated.

## Verification

- Production release gates passed: TypeScript, ESLint, 471 unit tests across 105 files, 199 legacy checks, and a successful Next.js build (28 tests in the SEO/feed-quality file).
- Four live Chrome browser tests passed across mobile and desktop: canonical identity, jobs H1, tool metadata, dashboard exclusion, favicon and stack-header checks.
- The earlier live crawl covered 154 non-job routes (including all 120 category routes) and 40 sampled jobs without failures. The post-backfill crawl now exposes a remaining sitemap freshness defect: it still advertises 5,259 job URLs, and one sampled retired job returns “Contract not found”/noindex. All other checked public metadata passed. Purging Vercel Data/CDN caches did not clear this Full Route/ISR snapshot. Explicit sitemap path invalidation/dynamic sitemap generation remains a release follow-up; **the final crawl is not a clean pass**. Current runtime inventory has 5,184 active rows. Empty category counts have changed to 14 with refreshed source data.
- In that 40-job sample, 22 pages had JobPosting markup and 18 provider summaries were correctly withheld. These are required-field/content checks, not a Google Rich Results certification. [Google's JobPosting requirements](https://developers.google.com/search/docs/appearance/structured-data/job-posting) require complete descriptions, and markup alone does not guarantee inclusion or ranking.
- Apex/www HTTPS HSTS headers and path/query preservation were checked separately; favicon returned 200 and dashboard retained its noindex response header.

Source providers must supply complete advertisements to extend Google for Jobs coverage to the remaining summaries. Do not generate missing job responsibilities or mark snippets as complete advertisements.

The Railway preparation includes a cache adapter that expires both the public-jobs data tag and `/sitemap.xml` Full Route cache, with a focused regression test. It has not been deployed; the live sitemap issue remains open pending release verification.
