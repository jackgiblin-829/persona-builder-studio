export const SPARKTORO_SECTIONS = [
  "demographics",
  "bios",
  "websites",
  "social_accounts",
  "networks",
  "youtube",
  "podcasts",
  "reddit",
  "press",
  "apps_and_ai_tools",
  "brands",
  "keywords",
  "prompt_topics",
  "market_size",
] as const;
export type SparktoroSection = (typeof SPARKTORO_SECTIONS)[number];

export const REQUIRED_SPARKTORO_SECTIONS: SparktoroSection[] = [
  "demographics",
  "bios",
  "keywords",
  "prompt_topics",
];

export const SPARKTORO_SECTION_COSTS: Record<SparktoroSection, number> = {
  demographics: 1,
  bios: 5,
  websites: 2,
  social_accounts: 2,
  networks: 1,
  youtube: 1,
  podcasts: 1,
  reddit: 2,
  press: 2,
  apps_and_ai_tools: 2,
  brands: 2,
  keywords: 5,
  prompt_topics: 2,
  market_size: 3,
};
export const SPARKTORO_REPORT_CREATION_COST = 10;
export const SPARKTORO_MAX_REPORT_COST =
  SPARKTORO_REPORT_CREATION_COST +
  Object.values(SPARKTORO_SECTION_COSTS).reduce((total, value) => total + value, 0);

export type SparktoroResult<T> = {
  data: T;
  dataOrigin: "mock" | "live";
  creditsUsed: number;
  raw: Record<string, unknown>;
  attempts?: number;
};

export type CreditBalance = {
  creditsRemaining: number;
  creditsExpiresAt: string | null;
  isTrial: boolean;
  lowBalance: boolean;
  rateLimitPerMinute: number;
};

export type CreateAudienceReportRequest = { description: string; location: "us" | "ca" | "uk" };
export type CreateAudienceReportResult = { reportId: string; status: "ready" };
export type GetSectionRequest = { reportId: string; section: SparktoroSection };
export type GetSectionResult = {
  status: "ready";
  section: SparktoroSection;
  normalized: Record<string, unknown>;
};

export interface SparktoroAdapter {
  readonly mode: "mock" | "live";
  getCreditBalance(): Promise<SparktoroResult<CreditBalance>>;
  createAudienceReport(
    request: CreateAudienceReportRequest,
  ): Promise<SparktoroResult<CreateAudienceReportResult>>;
  getSection(request: GetSectionRequest): Promise<SparktoroResult<GetSectionResult>>;
}
