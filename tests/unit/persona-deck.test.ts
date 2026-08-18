import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import type { PersonaInsight, PersonaProfile } from "@/contracts/studio";
import { createPersonaDeckPresentation } from "@/services/persona-deck";

const insight = (text: string, index = 1): PersonaInsight => ({
  text,
  signalIds: [`sig-${index}`],
  confidence: 0.84,
});

function profile(name: string): PersonaProfile {
  return {
    summary: `${name} evaluates the category through fit, proof, implementation effort, and risk.`,
    presentation: {
      role: insight("Considered Category Buyer"),
      industry: insight("Consumer Wellness / Lifestyle"),
      expertiseLevel: insight("Practitioner"),
      tone: insight("Measured, discerning, and evidence-led. Responds to clear proof."),
      povLens: insight(
        "Filters every purchase through practical fit, product integrity, long-term value, and confidence in the decision.",
      ),
      caresAbout: [
        insight("A clear fit for the real use case", 2),
        insight("Credible proof and transparent methodology", 3),
        insight("Realistic setup and implementation requirements", 4),
        insight("Long-term quality and value", 5),
      ],
      neverSay: [
        insight("“Just trust us” without proof", 6),
        insight("“Setup is effortless” without specifics", 7),
        insight("“One option is right for everyone”", 8),
      ],
      contentBestSuitedFor: [
        insight(
          "Evidence-led comparisons, practical guides, and proof-rich evaluation content.",
          9,
        ),
        insight("Best paired with evaluation-stage pillars and conversion pages.", 10),
      ],
    },
    demographics: { age: [], gender: [], income: [], education: [], geography: [] },
    firmographics: {
      roles: [insight("Considered Category Buyer")],
      seniority: [insight("Practitioner")],
      departments: [insight("Consumer")],
      industries: [insight("Consumer Wellness / Lifestyle")],
      companySize: [insight("Not applicable")],
      experience: [insight("Experienced evaluator")],
    },
    jobsToBeDone: [insight("Choose the right solution")],
    motivations: [insight("Make a confident decision")],
    goals: [insight("Find a durable fit")],
    painPoints: [insight("Generic claims")],
    constraints: [insight("Space, budget, and implementation")],
    successMeasures: [insight("A decision that performs as expected")],
    decisionCriteria: [insight("Fit, proof, effort, and value")],
    objections: [insight("Unverified claims")],
    commonQuestions: [insight("Which option is the best fit?")],
    proofNeeds: [insight("Independent evidence")],
    vocabulary: [insight("best fit")],
    buyingTriggers: [insight("An active replacement decision")],
    channels: [insight("Search")],
    communities: [insight("Peer communities")],
    websites: [insight("Trusted category publications")],
    contentPreferences: [insight("Concise comparisons with detailed proof")],
    keywords: [insight("category comparison")],
    aiPromptTopics: [insight("solution comparison")],
  };
}

describe("client persona deck export", () => {
  it("creates the reference-format narrative and two slides per persona", async () => {
    const personas = [
      "The Considered Buyer",
      "The Practical Operator",
      "The Proof Seeker",
      "The Champion",
    ].map((name, index) => ({
      name,
      version: index + 1,
      dataOrigin: "local" as const,
      profile: profile(name),
    }));
    const presentation = createPersonaDeckPresentation({
      clientName: "Example Client",
      generatedAt: new Date("2026-08-18T12:00:00.000Z"),
      personas,
    });
    const output = await presentation.write({ outputType: "nodebuffer", compression: true });
    const zip = await JSZip.loadAsync(output as Buffer);
    const slideNames = Object.keys(zip.files)
      .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
      .sort();
    expect(slideNames).toHaveLength(15);
    const text = (
      await Promise.all(slideNames.map((name) => zip.file(name)!.async("string")))
    ).join("\n");
    expect(text).toContain("Example Client");
    expect(text).toContain("What They Care About");
    expect(text).toContain("What They Would Never Say");
    expect(text).toContain("Content Best Suited For");
    expect(text).toContain("The Champion");
  });
});
