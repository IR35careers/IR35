import type { MetadataRoute } from "next";
import { allSeoSlugs, getSeoPage } from "@/lib/seo-pages";
import { getPublicJobInventory, matchesSeoFilters } from "@/lib/public-job-inventory";
import { SITE_ORIGIN } from "@/lib/seo";
import { BLOG_POSTS } from "@/lib/blog-posts";

// Match the public inventory freshness window.
export const revalidate = 300;

const BASE = SITE_ORIGIN;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const inventory = await getPublicJobInventory();

  const entries: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/jobs`, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE}/analyse-job`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools/take-home`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools/ir35-status`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/resources`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/ir35-careers`, changeFrequency: "weekly", priority: 0.85 },
    { url: `${BASE}/blog`, changeFrequency: "weekly", priority: 0.6 },
    ...BLOG_POSTS.map((post) => ({
      url: `${BASE}/blog/${post.slug}`,
      lastModified: new Date(`${post.updatedAt}T12:00:00Z`),
      changeFrequency: "monthly" as const,
      priority: 0.65,
    })),
    { url: `${BASE}/changelog`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/beta`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/employers`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/platforms`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/mobile`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/messaging`, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/pricing`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/stories`, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contact`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/about`, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/privacy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/cookies`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/billing-policy`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/accessibility`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/ai-disclosure`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/security`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/bug-bounty`, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/job-listing-policy`, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/delete-account`, changeFrequency: "yearly", priority: 0.3 },
    ...allSeoSlugs().filter((slug) => {
      const page = getSeoPage(slug);
      return page && inventory.some(job => matchesSeoFilters(job, page.filters));
    }).map((slug) => ({
      url: `${BASE}/contracts/${slug}`,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];

  // Use the same active inventory as category counts, without the old 1,000-row cap.
  for (const job of inventory) {
    entries.push({
      url: `${BASE}/jobs/${job.id}`,
      lastModified: new Date(job.last_seen_at ?? job.posted_at ?? job.first_seen_at),
      changeFrequency: "daily",
      priority: 0.6,
    });
  }

  return entries;
}
