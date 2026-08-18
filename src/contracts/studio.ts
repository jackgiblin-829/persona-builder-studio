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

export type PersonaPresentationProfile = {
  role: PersonaInsight;
  industry: PersonaInsight;
  expertiseLevel: PersonaInsight;
  tone: PersonaInsight;
  povLens: PersonaInsight;
  caresAbout: PersonaInsight[];
  neverSay: PersonaInsight[];
  contentBestSuitedFor: PersonaInsight[];
};

export type PersonaProfile = {
  summary: string;
  /**
   * Purpose-built, client-facing copy for the persona deck. Older immutable
   * versions may not include it, so deck consumers must use
   * `resolvePersonaPresentationProfile` rather than reading it directly.
   */
  presentation?: PersonaPresentationProfile;
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

function firstInsight(...groups: PersonaInsight[][]): PersonaInsight {
  return (
    groups.flat().find((item) => item.text.trim().length > 0) ?? {
      text: "Not yet supported by the available research.",
      signalIds: [],
      confidence: 0,
    }
  );
}

function uniqueInsights(groups: PersonaInsight[][], limit: number): PersonaInsight[] {
  const seen = new Set<string>();
  const values: PersonaInsight[] = [];
  for (const item of groups.flat()) {
    const key = item.text.trim().toLocaleLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    values.push(item);
    if (values.length === limit) break;
  }
  return values.length ? values : [firstInsight()];
}

/**
 * Keeps historical persona versions exportable while all newly generated and
 * edited versions persist the explicit client-deck fields.
 */
export function resolvePersonaPresentationProfile(
  profile: PersonaProfile,
): PersonaPresentationProfile {
  if (profile.presentation) return profile.presentation;
  return {
    role: firstInsight(profile.firmographics.roles, profile.jobsToBeDone),
    industry: firstInsight(profile.firmographics.industries),
    expertiseLevel: firstInsight(profile.firmographics.experience, profile.firmographics.seniority),
    tone: firstInsight(profile.vocabulary, profile.contentPreferences, profile.proofNeeds),
    povLens: {
      ...firstInsight(profile.jobsToBeDone, profile.decisionCriteria, profile.goals),
      text: profile.summary,
    },
    caresAbout: uniqueInsights(
      [profile.motivations, profile.goals, profile.decisionCriteria, profile.proofNeeds],
      5,
    ),
    neverSay: uniqueInsights([profile.objections, profile.constraints], 4),
    contentBestSuitedFor: uniqueInsights(
      [profile.contentPreferences, profile.aiPromptTopics, profile.commonQuestions],
      3,
    ),
  };
}
