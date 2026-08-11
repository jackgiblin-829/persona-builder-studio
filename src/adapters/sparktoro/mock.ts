import "server-only";
import { createHash } from "node:crypto";
import {
  SPARKTORO_SECTION_COSTS,
  type CreateAudienceReportRequest,
  type CreditBalance,
  type GetSectionRequest,
  type SparktoroAdapter,
  type SparktoroResult,
} from "./types";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function number(seed: string, min: number, max: number) {
  const fraction = Number.parseInt(hash(seed).slice(0, 8), 16) / 0xffffffff;
  return Math.round((min + fraction * (max - min)) * 10) / 10;
}

const POOLS: Record<string, string[]> = {
  bios: ["security", "operations", "strategy", "growth", "enterprise", "customer experience"],
  websites: ["hbr.org", "gartner.com", "forrester.com", "techcrunch.com", "linkedin.com"],
  social_accounts: [
    "Industry analysts",
    "Practitioner leaders",
    "Technology publications",
    "Peer operators",
  ],
  networks: ["LinkedIn", "YouTube", "Reddit", "X"],
  youtube: ["Enterprise Technology", "Modern Operations", "B2B Growth", "Security Now"],
  podcasts: ["The Modern Operator", "CIO Exchange", "B2B Growth", "Security Conversations"],
  reddit: ["r/cybersecurity", "r/SaaS", "r/operations", "r/technology"],
  press: ["Harvard Business Review", "Fast Company", "Wired", "MIT Technology Review"],
  apps_and_ai_tools: ["ChatGPT", "Microsoft Copilot", "Slack", "Notion", "Salesforce"],
  brands: ["Microsoft", "Google", "Salesforce", "Adobe", "Atlassian"],
  keywords: [
    "best solution",
    "implementation requirements",
    "enterprise comparison",
    "security proof",
    "total cost",
  ],
  prompt_topics: [
    "compare solutions",
    "validate security",
    "build a business case",
    "plan implementation",
    "measure ROI",
  ],
};

export class MockSparktoroAdapter implements SparktoroAdapter {
  readonly mode = "mock" as const;

  async getCreditBalance(): Promise<SparktoroResult<CreditBalance>> {
    const data = {
      creditsRemaining: 10_000,
      creditsExpiresAt: null,
      isTrial: false,
      lowBalance: false,
      rateLimitPerMinute: 60,
    };
    return { data, dataOrigin: "mock", creditsUsed: 0, raw: { mock: true, ...data } };
  }

  async createAudienceReport(request: CreateAudienceReportRequest) {
    const data = {
      reportId: `mock_${hash(`${request.description}:${request.location}`).slice(0, 20)}`,
      status: "ready" as const,
    };
    return { data, dataOrigin: "mock" as const, creditsUsed: 10, raw: { mock: true, ...data } };
  }

  async getSection(request: GetSectionRequest) {
    let normalized: Record<string, unknown>;
    if (request.section === "demographics") {
      normalized = {
        distributions: {
          age: [
            { name: "35–44", value: 34 },
            { name: "25–34", value: 27 },
          ],
          gender: [
            { name: "Women", value: 51 },
            { name: "Men", value: 49 },
          ],
          salary: [
            { name: "$125k+", value: 39 },
            { name: "$75k–$124k", value: 36 },
          ],
          education_degree: [
            { name: "Bachelor’s", value: 46 },
            { name: "Graduate degree", value: 29 },
          ],
          country: [{ name: "Primary project market", value: 100 }],
          title_role: [
            { name: "Operations", value: 32 },
            { name: "Technology", value: 29 },
          ],
          department: [
            { name: "Operations", value: 35 },
            { name: "IT", value: 31 },
          ],
          industry: [
            { name: "Technology", value: 28 },
            { name: "Professional services", value: 24 },
          ],
          company_employee_count: [
            { name: "1,000–4,999", value: 31 },
            { name: "250–999", value: 27 },
          ],
          years_experience: [{ name: "10–15 years", value: 36 }],
          seniority: [
            { name: "Director", value: 34 },
            { name: "VP", value: 23 },
          ],
        },
      };
    } else if (request.section === "market_size") {
      normalized = { estimated_population: Math.round(number(request.reportId, 80_000, 900_000)) };
    } else {
      normalized = {
        items: (POOLS[request.section] ?? [request.section]).map((label, index) => ({
          label,
          affinity: number(`${request.reportId}:${request.section}:${label}`, 20, 95) - index,
        })),
      };
    }
    const data = { status: "ready" as const, section: request.section, normalized };
    return {
      data,
      dataOrigin: "mock" as const,
      creditsUsed: SPARKTORO_SECTION_COSTS[request.section],
      raw: { mock: true, data: normalized },
      attempts: 1,
    };
  }
}
