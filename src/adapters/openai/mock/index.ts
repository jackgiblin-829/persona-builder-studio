/**
 * Registers every deterministic mock generator. Imported once by the adapter
 * factory. Generators are added as their milestone lands.
 */
import { registerMockGenerator } from "../mock";
import {
  CANDIDATE_SEGMENTATION,
  EVIDENCE_EXTRACTION,
  PERSONA_SYNTHESIS,
  PROMPT_GENERATION,
} from "@/prompts/registry";
import { generateEvidence, type EvidenceMockContext } from "./evidence";
import { generateSegmentation, type SegmentationMockContext } from "./segmentation";
import { generatePersona, type PersonaMockContext } from "./persona";
import { generatePrompts, type PromptMockContext } from "./prompts";

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
