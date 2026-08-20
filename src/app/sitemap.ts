import type { MetadataRoute } from "next";
import { supabase } from "@/lib/supabase";
import { isSupabaseConfigured } from "@/lib/supabase-config";
import { allSeoSlugs } from "@/lib/seo-pages";

// Refresh the sitemap hourly.
export const revalidate = 3600;

const BASE = "https://ir35careers.com";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    { url: `${BASE}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${BASE}/jobs`, lastModified: now, changeFrequency: "hourly", priority: 0.9 },
    { url: `${BASE}/jobs/sources`, lastModified: now, changeFrequency: "hourly", priority: 0.6 },
    { url: `${BASE}/analyse-job`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools/take-home`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/tools/ir35-status`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/resources`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${BASE}/blog`, lastModified: now, changeFrequency: "weekly", priority: 0.6 },
    { url: `${BASE}/changelog`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/platforms`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/mobile`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/messaging`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/connections`, lastModified: now, changeFrequency: "weekly", priority: 0.5 },
    { url: `${BASE}/pricing`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${BASE}/developers`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/stories`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE}/contact`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/privacy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/cookies`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/billing-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/terms`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/accessibility`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/ai-disclosure`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/security`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/bug-bounty`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    { url: `${BASE}/job-listing-policy`, lastModified: now, changeFrequency: "yearly", priority: 0.4 },
    { url: `${BASE}/delete-account`, lastModified: now, changeFrequency: "yearly", priority: 0.3 },
    ...allSeoSlugs().map((slug) => ({
      url: `${BASE}/contracts/${slug}`,
      lastModified: now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    })),
  ];

  // Active job detail pages (capped; newest first). Static routes remain
  // buildable when credentials are intentionally absent in preview and CI.
  if (isSupabaseConfigured()) {
    const { data } = await supabase
      .from("jobs")
      .select("id, last_seen_at")
      .is("expired_at", null)
      .order("posted_on", { ascending: false, nullsFirst: false })
      .limit(1000);

    for (const job of data ?? []) {
      entries.push({
        url: `${BASE}/jobs/${job.id}`,
        lastModified: new Date(job.last_seen_at),
        changeFrequency: "daily",
        priority: 0.6,
      });
    }
  }

  return entries;
}
