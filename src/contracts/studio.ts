export const GEO_CATEGORIES = [
  "problem_discovery",
  "foundational_education",
  "solution_recommendations",
  "comparisons_and_alternatives",
  "evaluation_trust_and_proof",
  "objections_and_risk",
  "purchase_and_selection",
  "implementation_and_optimization",
] as const;

export type GeoCategory = (typeof GEO_CATEGORIES)[number];

export type PersonaInsight = {
  text: string;
  signalIds: string[];
  confidence: number;
};

export type AudienceDistribution = {
  label: string;
  value: number;
  unit?: "percent" | "index" | "count";
  signalIds: string[];
};

export type PersonaProfile = {
  summary: string;
  demographics: {
    age: AudienceDistribution[];
    gender: AudienceDistribution[];
    income: AudienceDistribution[];
    education: AudienceDistribution[];
    geography: AudienceDistribution[];
  };
  firmographics: {
    roles: PersonaInsight[];
    seniority: PersonaInsight[];
    departments: PersonaInsight[];
    industries: PersonaInsight[];
    companySize: PersonaInsight[];
    experience: PersonaInsight[];
  };
  jobsToBeDone: PersonaInsight[];
  motivations: PersonaInsight[];
  goals: PersonaInsight[];
  painPoints: PersonaInsight[];
  constraints: PersonaInsight[];
  successMeasures: PersonaInsight[];
  decisionCriteria: PersonaInsight[];
  objections: PersonaInsight[];
  commonQuestions: PersonaInsight[];
  proofNeeds: PersonaInsight[];
  vocabulary: PersonaInsight[];
  buyingTriggers: PersonaInsight[];
  channels: PersonaInsight[];
  communities: PersonaInsight[];
  websites: PersonaInsight[];
  contentPreferences: PersonaInsight[];
  keywords: PersonaInsight[];
  aiPromptTopics: PersonaInsight[];
};
