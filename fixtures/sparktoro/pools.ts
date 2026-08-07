/**
 * Static vocabulary the deterministic SparkToro mock draws from.
 *
 * Like the DataForSEO mock (`fixtures/dataforseo/pools.ts`), SparkToro can be
 * asked about any free-text audience description, so there is no single
 * seeded account to model — generators hash `(description, pool member)` to
 * pick a stable, plausible subset per section.
 */

export const WEBSITE_POOL: readonly string[] = [
  "techcrunch.com",
  "producthunt.com",
  "news.ycombinator.com",
  "reddit.com",
  "linkedin.com",
  "g2.com",
  "stackoverflow.com",
  "medium.com",
  "substack.com",
  "indiehackers.com",
  "lennysnewsletter.com",
  "a16z.com",
  "gartner.com",
  "forrester.com",
  "capterra.com",
];

export const SOCIAL_ACCOUNT_POOL: readonly string[] = [
  "@lennysan",
  "@shreyas",
  "@patrickcollison",
  "@packyM",
  "@shl",
  "@rrhoover",
  "@julian",
  "@jasonlk",
  "@dharmesh",
  "@garrytan",
];

export const NETWORK_POOL: readonly string[] = [
  "LinkedIn",
  "X (Twitter)",
  "Reddit",
  "YouTube",
  "Substack",
  "Slack communities",
  "Discord communities",
];

export const YOUTUBE_CHANNEL_POOL: readonly string[] = [
  "Lenny's Podcast",
  "Y Combinator",
  "This Week in Startups",
  "a16z",
  "Product School",
  "SaaStr",
];

export const PODCAST_POOL: readonly string[] = [
  "Lenny's Podcast",
  "Acquired",
  "The Product Podcast",
  "SaaStr",
  "Masters of Scale",
  "How I Built This",
  "Invest Like the Best",
];

export const SUBREDDIT_POOL: readonly string[] = [
  "r/ProductManagement",
  "r/SaaS",
  "r/startups",
  "r/analytics",
  "r/marketing",
  "r/Entrepreneur",
];

export const PRESS_POOL: readonly string[] = [
  "TechCrunch",
  "The Information",
  "Axios Pro Rata",
  "Business Insider",
  "Forbes",
  "Fast Company",
];

export const APP_AND_AI_TOOL_POOL: readonly string[] = [
  "ChatGPT",
  "Notion AI",
  "Perplexity",
  "Superhuman",
  "Linear",
  "Figma",
  "Slack",
];

export const KEYWORD_POOL: readonly string[] = [
  "product led growth",
  "activation metrics",
  "self-serve onboarding",
  "north star metric",
  "customer retention",
  "usage-based pricing",
  "product analytics",
  "growth loops",
];

export const PROMPT_TOPIC_POOL: readonly string[] = [
  "best product analytics tools for b2b saas",
  "how to reduce churn with product data",
  "product led growth vs sales led growth",
  "how to set a north star metric",
  "self-hosted vs cloud analytics platforms",
];

export const BIO_KEYWORD_POOL: readonly string[] = [
  "product",
  "growth",
  "SaaS",
  "founder",
  "B2B",
  "data",
  "analytics",
  "startup",
  "PLG",
  "marketing",
];

export const DEMOGRAPHIC_LABEL_POOL: readonly string[] = [
  "25-34 years old",
  "35-44 years old",
  "United States",
  "United Kingdom",
  "Works at a company with 51-200 employees",
  "Works at a company with 201-1000 employees",
  "Holds a director or VP title",
  "Holds an individual-contributor title",
];
