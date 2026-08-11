import type { PromptStrategy } from "./prompt-strategy";

export type MarketResearchFact = {
  id: string;
  kind:
    | "brand_identity"
    | "entity_relationship"
    | "category"
    | "business_line"
    | "competitor"
    | "buyer_context"
    | "freshness_fact";
  claim: string;
  sourceTitle: string;
  sourceUrl: string;
  sourceType: "web" | "uploaded";
  retrievedAt: string;
};

export type MarketResearchBriefContent = {
  summary: string;
  strategy: PromptStrategy;
  facts: MarketResearchFact[];
  researchNotes: string[];
};

export type ResearchBriefStatus = "draft" | "approved" | "superseded";

export const RESEARCH_STALE_DAYS = 30;

export function researchBriefIsStale(staleAt: Date | string, now = new Date()) {
  return new Date(staleAt).getTime() <= now.getTime();
}

export function researchFactMap(brief: MarketResearchBriefContent) {
  return new Map(brief.facts.map((fact) => [fact.id, fact]));
}
