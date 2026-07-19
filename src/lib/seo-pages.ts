/**
 * SEO landing-page registry.
 *
 * Curated, bounded set of keyword pages (~130) rather than infinite
 * combinations — Google penalizes thin auto-generated pages, and a bounded
 * registry keeps every page real: live counts, live listings, internal links.
 *
 * Each entry maps a slug to display copy + the filters used to query jobs.
 */

export interface SeoFilters {
  skill?: string; // canonical skill name as stored in jobs.skills
  location?: string; // substring match on jobs.location
  ir35?: "outside" | "inside";
  remote?: boolean;
}

export interface SeoPage {
  slug: string;
  h1: string;
  metaTitle: string;
  metaDescription: string;
  filters: SeoFilters;
}

/** [canonical skill, slug fragment] — explicit to avoid slugify edge cases. */
const SKILLS: Array<[string, string]> = [
  ["React", "react"],
  ["Python", "python"],
  ["Java", "java"],
  [".NET", "dotnet"],
  ["Node.js", "nodejs"],
  ["TypeScript", "typescript"],
  ["AWS", "aws"],
  ["Azure", "azure"],
  ["DevOps", "devops"],
  ["Data Engineering", "data-engineering"],
  ["Data Science", "data-science"],
  ["Machine Learning", "machine-learning"],
  ["Kubernetes", "kubernetes"],
  ["Salesforce", "salesforce"],
  ["SAP", "sap"],
  ["Cyber Security", "cyber-security"],
  ["Business Analysis", "business-analyst"],
  ["Project Management", "project-manager"],
  ["Solutions Architecture", "solutions-architect"],
  ["QA/Testing", "qa-testing"],
];

/** Skills popular enough to earn location and IR35 variants. */
const TOP_SKILL_SLUGS = new Set([
  "react",
  "python",
  "java",
  "dotnet",
  "aws",
  "azure",
  "devops",
  "data-engineering",
  "business-analyst",
  "project-manager",
]);

const LOCATIONS: Array<[string, string]> = [
  ["London", "london"],
  ["Manchester", "manchester"],
  ["Birmingham", "birmingham"],
  ["Leeds", "leeds"],
  ["Edinburgh", "edinburgh"],
  ["Glasgow", "glasgow"],
  ["Bristol", "bristol"],
];

function buildRegistry(): Map<string, SeoPage> {
  const pages: SeoPage[] = [];

  // IR35 hub pages — the product's core terms.
  pages.push(
    {
      slug: "outside-ir35-contracts",
      h1: "Outside IR35 Contract Jobs",
      metaTitle: "Outside IR35 Contracts — Live UK Roles",
      metaDescription:
        "Live UK contract roles explicitly advertised as Outside IR35, with day rates shown up front. Updated throughout the day.",
      filters: { ir35: "outside" },
    },
    {
      slug: "inside-ir35-contracts",
      h1: "Inside IR35 Contract Jobs",
      metaTitle: "Inside IR35 Contracts — Live UK Roles",
      metaDescription:
        "Live UK contract roles advertised as Inside IR35, with rates and workplace type up front. Updated throughout the day.",
      filters: { ir35: "inside" },
    },
    {
      slug: "remote-contracts",
      h1: "Remote UK Contract Jobs",
      metaTitle: "Remote Contract Jobs UK — Inside & Outside IR35",
      metaDescription:
        "Fully remote UK contract roles with IR35 status and day rates shown up front. Updated throughout the day.",
      filters: { remote: true },
    }
  );

  // Location hubs.
  for (const [loc, locSlug] of LOCATIONS) {
    pages.push({
      slug: `contracts-in-${locSlug}`,
      h1: `Contract Jobs in ${loc}`,
      metaTitle: `Contract Jobs in ${loc} — IR35 Status Up Front`,
      metaDescription: `Live contract roles in ${loc} with day rates and IR35 status shown up front. Inside and Outside IR35. Updated daily.`,
      filters: { location: loc },
    });
  }

  // Skill pages + variants.
  for (const [skill, skillSlug] of SKILLS) {
    pages.push({
      slug: `${skillSlug}-contracts`,
      h1: `${skill} Contract Jobs`,
      metaTitle: `${skill} Contracts UK — Day Rates & IR35 Status`,
      metaDescription: `Live UK ${skill} contract roles with day rates and IR35 status up front. Inside and Outside IR35. Updated daily.`,
      filters: { skill },
    });

    if (!TOP_SKILL_SLUGS.has(skillSlug)) continue;

    pages.push(
      {
        slug: `outside-ir35-${skillSlug}-contracts`,
        h1: `Outside IR35 ${skill} Contracts`,
        metaTitle: `Outside IR35 ${skill} Contracts — Live UK Roles`,
        metaDescription: `${skill} contract roles explicitly advertised as Outside IR35, with day rates shown. Updated daily.`,
        filters: { skill, ir35: "outside" },
      },
      {
        slug: `remote-${skillSlug}-contracts`,
        h1: `Remote ${skill} Contracts`,
        metaTitle: `Remote ${skill} Contract Jobs UK — IR35 Status Shown`,
        metaDescription: `Fully remote UK ${skill} contract roles with IR35 status and day rates up front. Updated daily.`,
        filters: { skill, remote: true },
      }
    );

    for (const [loc, locSlug] of LOCATIONS) {
      pages.push({
        slug: `${skillSlug}-contracts-${locSlug}`,
        h1: `${skill} Contract Jobs in ${loc}`,
        metaTitle: `${skill} Contracts in ${loc} — Day Rates & IR35`,
        metaDescription: `Live ${skill} contract roles in ${loc} with day rates and IR35 status up front. Updated daily.`,
        filters: { skill, location: loc },
      });
    }
  }

  return new Map(pages.map((p) => [p.slug, p]));
}

const REGISTRY = buildRegistry();

export function getSeoPage(slug: string): SeoPage | null {
  return REGISTRY.get(slug) ?? null;
}

export function allSeoSlugs(): string[] {
  return Array.from(REGISTRY.keys());
}

/** A handful of related pages for internal linking, excluding self. */
export function relatedSeoPages(current: SeoPage, limit = 8): SeoPage[] {
  const all = Array.from(REGISTRY.values());
  const scored = all
    .filter((p) => p.slug !== current.slug)
    .map((p) => {
      let score = 0;
      if (current.filters.skill && p.filters.skill === current.filters.skill) score += 3;
      if (current.filters.location && p.filters.location === current.filters.location) score += 2;
      if (current.filters.ir35 && p.filters.ir35 === current.filters.ir35) score += 2;
      if (current.filters.remote && p.filters.remote) score += 1;
      // Hubs are always decent links.
      if (!p.filters.skill && !p.filters.location) score += 1;
      return { p, score };
    })
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((s) => s.p);
}
