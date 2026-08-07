/**
 * The mock Profound account.
 *
 * This is a fixture of *vendor state*, not of vendor answers: the mock adapter
 * reads and writes against it the way a real account would behave, so the
 * deployment path exercises real duplicate detection, real mapping states and
 * real partial failure rather than a canned response.
 *
 * Two of the existing prompts are deliberately chosen to collide with the
 * seeded prompt set:
 *
 * - `pfp_existing_best_platforms` is an **exact** duplicate of a seeded generic
 *   control. Generic questions are precisely what a brand already tracks, so
 *   this is the realistic collision, and it must be caught before deployment
 *   rather than after it has split one measurement across two prompt rows.
 * - `pfp_existing_compare_the` differs from a seeded control by one article.
 *   It hashes differently, so only the similarity check finds it — which is the
 *   whole reason the exact check is not sufficient on its own.
 *
 * Everything here is fictional. The organization, category, assets and personas
 * describe the same invented B2B analytics brand the evidence seed uses.
 */

import type {
  ProfoundAsset,
  ProfoundCategory,
  ProfoundExistingPrompt,
  ProfoundModel,
  ProfoundOrganization,
  ProfoundPersona,
  ProfoundRegion,
  ProfoundTag,
  ProfoundTopic,
} from "@/adapters/profound/types";

export const MOCK_ORGANIZATIONS: ProfoundOrganization[] = [
  { id: "pfo_northwind", name: "Northwind Analytics" },
];

export const MOCK_CATEGORIES: ProfoundCategory[] = [
  {
    id: "pfc_product_analytics",
    name: "Product analytics",
    brandName: "Northwind Analytics",
    domain: "northwind-analytics.example",
  },
  {
    id: "pfc_data_governance",
    name: "Data governance",
    brandName: "Northwind Analytics",
    domain: "northwind-analytics.example",
  },
];

export const MOCK_REGIONS: ProfoundRegion[] = [
  { code: "us", name: "United States" },
  { code: "gb", name: "United Kingdom" },
  { code: "de", name: "Germany" },
];

export const MOCK_MODELS: ProfoundModel[] = [
  { id: "pfm_chatgpt", name: "ChatGPT", platform: "chatgpt" },
  { id: "pfm_perplexity", name: "Perplexity", platform: "perplexity" },
  { id: "pfm_aio", name: "Google AI Overviews", platform: "google-ai-overviews" },
  { id: "pfm_copilot", name: "Microsoft Copilot", platform: "copilot" },
];

export const MOCK_ASSETS: ProfoundAsset[] = [
  {
    id: "pfa_northwind_site",
    name: "northwind-analytics.example",
    domain: "northwind-analytics.example",
  },
  { id: "pfa_northwind_docs", name: "docs.northwind-analytics.example", domain: null },
];

export const MOCK_TOPICS: ProfoundTopic[] = [
  { id: "pft_deployment", name: "Deployment and hosting", categoryId: "pfc_product_analytics" },
  { id: "pft_pricing", name: "Pricing", categoryId: "pfc_product_analytics" },
  { id: "pft_evaluation", name: "Evaluation and procurement", categoryId: "pfc_product_analytics" },
  { id: "pft_compliance", name: "Compliance", categoryId: "pfc_data_governance" },
];

export const MOCK_TAGS: Record<string, ProfoundTag[]> = {
  pfc_product_analytics: [
    { name: "source:manual", promptCount: 6 },
    { name: "intent:comparison", promptCount: 2 },
  ],
  pfc_data_governance: [],
};

/**
 * Personas that exist in the mock account.
 *
 * Note what is *missing*: there is no persona resembling the seeded
 * security-led buyer. That absence is the point — it forces the §20 tag
 * fallback to be exercised by the demo rather than only by a test.
 */
export const MOCK_PERSONAS: ProfoundPersona[] = [
  {
    id: "pfp_persona_growth_pm",
    name: "Growth product manager",
    description: "Product manager optimising activation and retention funnels.",
    categoryId: "pfc_product_analytics",
  },
  {
    id: "pfp_persona_data_lead",
    name: "Analytics engineering lead",
    description: "Owns the warehouse and the modelling layer.",
    categoryId: null,
  },
];

export const MOCK_EXISTING_PROMPTS: ProfoundExistingPrompt[] = [
  {
    id: "pfp_existing_best_platforms",
    // Byte-identical to a seeded generic control — the exact-duplicate case.
    text: "What are the best product-analytics platforms?",
    topic: "Evaluation and procurement",
    tags: ["source:manual"],
    personaId: null,
    regions: ["us"],
    platforms: ["chatgpt", "perplexity"],
    status: "active",
  },
  {
    id: "pfp_existing_compare_the",
    // One article away from a seeded control — only similarity finds this.
    text: "How do the product-analytics platforms compare?",
    topic: "Evaluation and procurement",
    tags: ["source:manual", "intent:comparison"],
    personaId: null,
    regions: ["us"],
    platforms: ["chatgpt"],
    status: "active",
  },
  {
    id: "pfp_existing_warehouse_native",
    text: "Which analytics tools run natively on Snowflake?",
    topic: "Deployment and hosting",
    tags: ["source:manual"],
    personaId: "pfp_persona_data_lead",
    regions: ["us"],
    platforms: ["chatgpt", "perplexity", "google-ai-overviews"],
    status: "active",
  },
  {
    id: "pfp_existing_pricing",
    text: "How much does product analytics software cost per seat?",
    topic: "Pricing",
    tags: ["source:manual"],
    personaId: "pfp_persona_growth_pm",
    regions: ["us", "gb"],
    platforms: ["chatgpt"],
    status: "active",
  },
];
