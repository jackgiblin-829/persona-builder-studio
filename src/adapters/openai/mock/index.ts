/**
 * Registers every deterministic mock generator. Imported once by the adapter
 * factory. Generators are added as their milestone lands.
 */
import { registerMockGenerator } from "../mock";
import {
  CANDIDATE_SEGMENTATION,
  CONTENT_GAP,
  EVIDENCE_EXTRACTION,
  PAGE_AUDIT,
  PERSONA_SYNTHESIS,
  PROMPT_GENERATION,
  SEO_BRIEF,
  WEB_RESEARCH_PLANNING,
} from "@/prompts/registry";
import { generateEvidence, type EvidenceMockContext } from "./evidence";
import { generateSegmentation, type SegmentationMockContext } from "./segmentation";
import { generatePersona, type PersonaMockContext } from "./persona";
import { generatePrompts, type PromptMockContext } from "./prompts";
import { generateOpportunities, type ContentGapMockContext } from "./content-gap";
import { generateBrief, type BriefMockContext } from "./seo-brief";
import { generateAudit, type PageAuditMockContext } from "./page-audit";
import { generateWebResearchPlan, type WebResearchPlanMockContext } from "./web-research-plan";

registerMockGenerator(EVIDENCE_EXTRACTION.id, (context) =>
  generateEvidence(context as unknown as EvidenceMockContext),
);

registerMockGenerator(CANDIDATE_SEGMENTATION.id, (context) =>
  generateSegmentation(context as unknown as SegmentationMockContext),
);

registerMockGenerator(PERSONA_SYNTHESIS.id, (context) =>
  generatePersona(context as unknown as PersonaMockContext),
);

registerMockGenerator(PROMPT_GENERATION.id, (context) =>
  generatePrompts(context as unknown as PromptMockContext),
);

registerMockGenerator(CONTENT_GAP.id, (context) =>
  generateOpportunities(context as unknown as ContentGapMockContext),
);

registerMockGenerator(SEO_BRIEF.id, (context) =>
  generateBrief(context as unknown as BriefMockContext),
);

registerMockGenerator(PAGE_AUDIT.id, (context) =>
  generateAudit(context as unknown as PageAuditMockContext),
);

registerMockGenerator(WEB_RESEARCH_PLANNING.id, (context) =>
  generateWebResearchPlan(context as unknown as WebResearchPlanMockContext),
);
