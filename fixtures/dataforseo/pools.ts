/**
 * Static vocabulary the deterministic DataForSEO mock draws from.
 *
 * Unlike the Profound mock (`fixtures/profound/account.ts`), which emulates
 * one fixed account, DataForSEO can be asked about *any* domain or keyword a
 * brand supplies — there is no single seeded account to model. So instead of
 * fixed rows, this file is a shared vocabulary: a pool of plausible B2B
 * SaaS/analytics search terms and a pool of competitor-shaped domains. The
 * generators in `generators.ts` hash `(input, pool member)` to decide
 * deterministically which pool members apply to a given target or keyword,
 * so the same input always produces the same result and different inputs
 * produce different, still-plausible ones.
 *
 * The competitor domain pool intentionally echoes the fictional competitor
 * names in `fixtures/profound/results.ts` (Rivergate Metrics, Beacon
 * Insights, Ledgerline Analytics) as `.example` domains, so a downstream
 * content-gap analyzer sees the same competitor set show up in both a
 * Profound AI-visibility run and a DataForSEO SERP — the two mock vendors
 * describe one coherent fictional market instead of two unrelated ones.
 */

/** A generic B2B analytics/SaaS keyword vocabulary, broad enough for any target. */
export const SEED_KEYWORD_POOL: readonly string[] = [
  "product analytics platform",
  "product analytics software",
  "best product analytics tools",
  "customer data platform vs product analytics",
  "how to track user behavior in a saas app",
  "product analytics pricing",
  "self-hosted product analytics",
  "product analytics for b2b saas",
  "user behavior analytics tools",
  "cohort analysis software",
  "feature adoption tracking tool",
  "product led growth analytics",
  "session replay software",
  "event tracking platform",
  "data governance for analytics",
  "gdpr compliant analytics platform",
  "analytics platform for enterprise",
  "real time analytics dashboard",
  "no code analytics tool",
  "warehouse native analytics",
  "churn prediction software",
  "onboarding funnel analytics",
  "retention analytics tool",
  "product usage reporting",
  "analytics api for developers",
];

/** SERP-modifier phrases used to derive related/suggested keywords from a seed. */
export const MODIFIER_POOL: readonly string[] = [
  "best",
  "top",
  "free",
  "vs",
  "alternative to",
  "for startups",
  "for enterprise",
  "pricing",
  "reviews",
  "comparison",
  "guide",
  "how to choose",
];

/**
 * Domains that appear as SERP results and as `getDomainCompetitors` rows. The
 * first three deliberately mirror the Profound mock's fictional competitors.
 */
export const COMPETITOR_DOMAIN_POOL: readonly string[] = [
  "rivergate-metrics.example",
  "beacon-insights.example",
  "ledgerline-analytics.example",
  "brightpath-analytics.example",
  "vantage-metrics.example",
  "clearline-data.example",
  "northfield-insights.example",
  "meridian-analytics.example",
];

/** Author names for synthetic reviews. Fictional, unconnected to any real person. */
export const REVIEWER_NAME_POOL: readonly string[] = [
  "J. Alvarez",
  "M. Chen",
  "S. Okafor",
  "R. Novak",
  "T. Larsen",
  "P. Iyer",
  "K. Dubois",
  "A. Kowalski",
  "L. Marchetti",
  "D. Haddad",
];

export const REVIEW_TEXT_TEMPLATES: readonly ((subject: string) => string)[] = [
  (subject) => `${subject} did exactly what we needed for onboarding, no complaints.`,
  (subject) => `Support was slow to respond, but ${subject} itself works as advertised.`,
  (subject) => `We evaluated a few options and ${subject} had the best pricing for our team size.`,
  (subject) => `${subject} took longer than expected to set up, but the dashboards are solid.`,
  (subject) => `Would recommend ${subject} to any team our size looking for this kind of tool.`,
  (subject) => `${subject} is fine but nothing that stands out versus competitors we tried.`,
];

/** A fixed anchor so review timestamps are deterministic, not `Date.now()`-derived. */
export const REVIEW_ANCHOR_DATE = "2026-01-01T00:00:00.000Z";
