import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  GEO_CATEGORIES,
  dataSources,
  generatedPrompts,
  integrations,
  marketResearchBriefs,
  memberships,
  organizations,
  personas,
  personaVersions,
  projects,
  promptClusters,
  promptSets,
  promptSetVersions,
  researchSignals,
  sourceDocuments,
  users,
  type PersonaInsight,
  type PersonaProfile,
} from "@/db/schema";
import { hashPassword, sha256 } from "@/lib/crypto";
import { ID_PREFIXES, newId, slugify } from "@/lib/ids";

const ORG_ID = "org_demo829";
const PROJECT_ID = "prj_northwind";
const USER_IDS = ["usr_admin", "usr_analyst", "usr_viewer"];

export async function runSeed({ fresh = true }: { fresh?: boolean } = {}) {
  if (fresh) {
    await db.delete(organizations).where(eq(organizations.id, ORG_ID));
    await db.delete(users).where(inArray(users.id, USER_IDS));
  }
  const [existing] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, ORG_ID))
    .limit(1);
  if (existing) return { organizations: 1, projects: 1, note: "seed already present" };

  await db.insert(organizations).values({ id: ORG_ID, name: "829 Demo", slug: "829-demo" });
  const userRows = [
    ["usr_admin", "admin@example.com", "Demo Owner", "demo-password-1", "owner"],
    ["usr_analyst", "analyst@example.com", "Demo Strategist", "demo-password-2", "editor"],
    ["usr_viewer", "viewer@example.com", "Demo Viewer", "demo-password-3", "viewer"],
  ] as const;
  for (const [id, email, name, password, role] of userRows) {
    await db.insert(users).values({ id, email, name, passwordHash: hashPassword(password) });
    await db
      .insert(memberships)
      .values({ id: newId(ID_PREFIXES.membership), organizationId: ORG_ID, userId: id, role });
  }
  await db.insert(integrations).values([
    { id: newId(ID_PREFIXES.integration), organizationId: ORG_ID, vendor: "openai", mode: "mock" },
    {
      id: newId(ID_PREFIXES.integration),
      organizationId: ORG_ID,
      vendor: "sparktoro",
      mode: "mock",
    },
  ]);
  await db.insert(projects).values({
    id: PROJECT_ID,
    organizationId: ORG_ID,
    name: "Northwind Enterprise Platform",
    slug: "northwind-enterprise-platform",
    canonicalDomain: "northwind.example",
    description:
      "An enterprise workflow platform that helps operations and technology teams standardize complex work and prove measurable outcomes.",
    primaryMarket: "US",
    languageLocale: "en-US",
    sparktoroAudienceDescription:
      "Operations, technology, security, and transformation leaders in the United States who evaluate enterprise workflow platforms",
    promptStrategy: {
      canonicalBrand: "Northwind Enterprise Platform",
      parentCompany: "Northwind Group",
      aliases: ["Northwind Platform"],
      entityCollisions: ["Northwind Traders"],
      categoryTerms: ["enterprise workflow platform", "workflow automation software"],
      businessLines: [
        "workflow automation",
        "security governance workflows",
        "operational reporting",
      ],
      competitors: ["Contoso Workflows", "Fabrikam Operations Cloud", "Adventure Works Flow"],
      buyerQualifiers: [
        "a regulated enterprise",
        "a 500-person operations team",
        "an organization replacing manual workflows",
      ],
      freshnessFacts: ["current product name", "current security certifications"],
      pathwaysPerPersona: 3,
      targetPromptCount: 50,
      funnelTargets: {
        awareness: 30,
        consideration: 15,
        decision: 5,
      },
    },
    promptStrategyEdited: false,
    audienceDescriptionEdited: true,
    sourceRevision: 3,
    activePersonaRevision: 3,
    createdByUserId: "usr_admin",
  });

  const sourceId = newId(ID_PREFIXES.dataSource);
  await db.insert(dataSources).values({
    id: sourceId,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    label: "Three discovery-call transcripts",
    sourceType: "sales_transcript",
    sourceSystem: "pasted_text",
    status: "completed",
    stage: "ready",
    progress: 100,
    documentCount: 3,
    signalCount: 12,
    piiRedactionCount: 4,
    piiStatus: "redacted",
    uploadedByUserId: "usr_analyst",
  });
  const documentId = newId(ID_PREFIXES.sourceDocument);
  await db.insert(sourceDocuments).values({
    id: documentId,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    dataSourceId: sourceId,
    title: "Seeded discovery-call excerpts",
    location: "transcript excerpts",
    rawText:
      "We need a decision the security team can defend. Operations wants a practical implementation path and leadership needs measurable proof.",
    redactedText:
      "We need a decision the security team can defend. Operations wants a practical implementation path and leadership needs measurable proof.",
    contentHash: sha256("seeded discovery call"),
  });

  const signalSeeds = [
    ["job_to_be_done", "Build a defensible enterprise-platform shortlist"],
    ["pain_point", "Generic vendor claims make meaningful comparison difficult"],
    ["constraint", "Security and governance review narrow acceptable options"],
    ["decision_criterion", "Fit, proof, implementation effort, and risk determine the choice"],
    ["proof_need", "Stakeholders require independent evidence and relevant examples"],
    ["question", "Which approach is the best fit for our operating environment?"],
    ["success_measure", "The selected platform produces measurable operating improvement"],
    ["vocabulary", "defensible shortlist"],
    ["sparktoro:keywords", "enterprise workflow platform comparison"],
    ["sparktoro:prompt_topics", "compare enterprise workflow solutions"],
    ["sparktoro:websites", "hbr.org"],
    ["demographic:seniority", "seniority: Director (34)"],
  ] as const;
  const signalIds: string[] = [];
  for (let index = 0; index < signalSeeds.length; index++) {
    const [category, text] = signalSeeds[index]!;
    const id = newId(ID_PREFIXES.researchSignal);
    signalIds.push(id);
    await db.insert(researchSignals).values({
      id,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      sourceKind:
        category.startsWith("sparktoro:") || category.startsWith("demographic:")
          ? "sparktoro"
          : "first_party",
      dataSourceId:
        category.startsWith("sparktoro:") || category.startsWith("demographic:") ? null : sourceId,
      category,
      displayText: text,
      structuredValue: category.startsWith("demographic:")
        ? { field: "seniority", label: "Director", value: 34, unit: "percent" }
        : {},
      provenance:
        category.startsWith("sparktoro:") || category.startsWith("demographic:")
          ? "externally_supported_aggregate"
          : "observed",
      sourceLocation:
        category.startsWith("sparktoro:") || category.startsWith("demographic:")
          ? "SparkToro seed"
          : "transcript excerpts",
      confidence: 0.82,
      dataOrigin:
        category.startsWith("sparktoro:") || category.startsWith("demographic:") ? "mock" : "local",
    });
  }

  const researchBriefId = newId(ID_PREFIXES.marketResearchBrief);
  const capturedAt = new Date();
  await db.insert(marketResearchBriefs).values({
    id: researchBriefId,
    organizationId: ORG_ID,
    projectId: PROJECT_ID,
    version: 1,
    status: "approved",
    content: {
      summary:
        "A seeded demo brief covering Northwind's entity, workflow category, business lines, competitors, and enterprise buyer context.",
      strategy: {
        canonicalBrand: "Northwind Enterprise Platform",
        parentCompany: "Northwind Group",
        aliases: ["Northwind Platform"],
        entityCollisions: ["Northwind Traders"],
        categoryTerms: ["enterprise workflow platform", "workflow automation software"],
        businessLines: [
          "workflow automation",
          "security governance workflows",
          "operational reporting",
        ],
        competitors: ["Contoso Workflows", "Fabrikam Operations Cloud", "Adventure Works Flow"],
        buyerQualifiers: [
          "a regulated enterprise",
          "a 500-person operations team",
          "an organization replacing manual workflows",
        ],
        freshnessFacts: ["current product name", "current security certifications"],
        pathwaysPerPersona: 3,
        targetPromptCount: 50,
        funnelTargets: {
          awareness: 30,
          consideration: 15,
          decision: 5,
        },
      },
      facts: [
        "canonical brand",
        "parent company",
        "entity collision",
        "workflow category",
        "workflow automation",
        "security governance workflows",
        "Contoso comparison",
        "enterprise buyer",
      ].map((claim, index) => ({
        id: `fact-${String(index + 1).padStart(3, "0")}`,
        kind: (
          [
            "brand_identity",
            "entity_relationship",
            "entity_relationship",
            "category",
            "business_line",
            "business_line",
            "competitor",
            "buyer_context",
          ] as const
        )[index]!,
        claim: `Seeded demo research supports the ${claim}.`,
        sourceTitle: "Northwind demo research",
        sourceUrl: `https://northwind.example/research-${index + 1}`,
        sourceType: "web" as const,
        retrievedAt: capturedAt.toISOString(),
      })),
      researchNotes: ["Demo evidence is synthetic and not suitable for production use."],
    },
    sourceRevision: 3,
    modelProvider: "mock",
    modelId: "mock:research",
    dataOrigin: "mock",
    capturedAt,
    staleAt: new Date(capturedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    approvedAt: capturedAt,
    approvedByUserId: "usr_admin",
  });

  const profileNames = [
    "Security-Led Enterprise Evaluator",
    "Outcome-Driven Operational Buyer",
    "Evidence-Seeking Strategic Champion",
  ];
  let promptCount = 0;
  for (let personaIndex = 0; personaIndex < profileNames.length; personaIndex++) {
    const name = profileNames[personaIndex]!;
    const personaId = newId(ID_PREFIXES.persona);
    const versionId = newId(ID_PREFIXES.personaVersion);
    const profile = seededProfile(name, signalIds);
    await db.insert(personas).values({
      id: personaId,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      name,
      slug: slugify(name),
      currentVersionId: versionId,
    });
    await db.insert(personaVersions).values({
      id: versionId,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      personaId,
      version: 1,
      name,
      description: profile.summary,
      profile,
      sourceRevision: 3,
      overallConfidence: 0.82,
      modelProvider: "mock",
      modelId: "mock:gpt-4.1",
      promptTemplateVersion: "2.0.0",
      schemaVersion: "2.0.0",
      dataOrigin: "mock",
      createdByUserId: "usr_analyst",
    });
    const setId = newId(ID_PREFIXES.promptSet);
    const setVersionId = newId(ID_PREFIXES.promptSetVersion);
    await db.insert(promptSets).values({
      id: setId,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      personaId,
      currentVersionId: setVersionId,
    });
    await db.insert(promptSetVersions).values({
      id: setVersionId,
      organizationId: ORG_ID,
      projectId: PROJECT_ID,
      promptSetId: setId,
      personaVersionId: versionId,
      version: 1,
      clusterCount: 3,
      promptCount: 50,
      modelProvider: "mock",
      modelId: "mock:gpt-4.1",
      dataOrigin: "mock",
      researchBriefId,
    });
    const titles = [
      "Workflow automation decision pathway",
      "Security governance workflows decision pathway",
      "Operational reporting decision pathway",
    ];
    const plans: Array<{
      key: string;
      parentKey: string | null;
      stage: "decision" | "consideration" | "awareness";
      stageIndex: number;
      pathwayIndex: number;
    }> = [];
    const addPlans = (
      stage: "decision" | "consideration" | "awareness",
      count: number,
      parents: typeof plans,
    ) => {
      const added: typeof plans = [];
      for (let index = 0; index < count; index++) {
        const parent = parents.length ? parents[index % parents.length]! : null;
        const pathwayIndex = parent?.pathwayIndex ?? index % titles.length;
        const plan = {
          key: `cell-${String(promptCount + plans.length + 1).padStart(3, "0")}`,
          parentKey: parent?.key ?? null,
          stage,
          stageIndex: index,
          pathwayIndex,
        };
        plans.push(plan);
        added.push(plan);
      }
      return added;
    };
    const decisions = addPlans("decision", 5, []);
    const considerations = addPlans("consideration", 15, decisions);
    addPlans("awareness", 30, considerations);
    for (let clusterIndex = 0; clusterIndex < titles.length; clusterIndex++) {
      const title = titles[clusterIndex]!;
      const clusterId = newId(ID_PREFIXES.promptCluster);
      const clusterPlans = plans.filter((plan) => plan.pathwayIndex === clusterIndex);
      await db.insert(promptClusters).values({
        id: clusterId,
        organizationId: ORG_ID,
        projectId: PROJECT_ID,
        promptSetVersionId: setVersionId,
        personaVersionId: versionId,
        sequence: clusterIndex,
        title,
        slug: slugify(title),
        seedTopic: [
          "workflow automation",
          "security governance workflows",
          "operational reporting",
        ][clusterIndex]!,
        informationNeed: `${name} moves from bottom-of-funnel selection through evaluation and awareness for ${title.replace(" decision pathway", "")}.`,
        rationale:
          "This Query Funnel pathway starts with a conversion-adjacent anchor and projects upward.",
        signalIds: signalIds.slice(0, 4),
      });
      for (let promptIndex = 0; promptIndex < clusterPlans.length; promptIndex++) {
        const plan = clusterPlans[promptIndex]!;
        const businessLine = title.replace(" decision pathway", "");
        const angle = [
          "security requirements",
          "implementation effort",
          "proof of outcomes",
          "stakeholder adoption",
          "total operating cost",
          "governance",
          "integration fit",
          "vendor risk",
          "change management",
          "reporting needs",
          "time to value",
          "customer support",
          "scalability",
          "data quality",
          "procurement concerns",
          "team capacity",
          "long-term flexibility",
          "budget ownership",
          "regulatory exposure",
          "training needs",
          "workflow complexity",
          "executive sponsorship",
          "cross-functional alignment",
          "data migration",
          "audit readiness",
          "service reliability",
          "contract flexibility",
          "deployment speed",
          "measurement criteria",
          "future requirements",
        ][plan.stageIndex % 30]!;
        const promptText =
          plan.stage === "decision"
            ? `Is Northwind Enterprise Platform a strong choice for ${businessLine} when ${angle} is important to ${name.toLowerCase()} stakeholders?`
            : plan.stage === "consideration"
              ? `What proof and tradeoffs should ${name.toLowerCase()} stakeholders evaluate about ${angle} when comparing ${businessLine} options?`
              : `How can ${name.toLowerCase()} teams improve ${businessLine} when ${angle} creates friction?`;
        await db.insert(generatedPrompts).values({
          id: newId(ID_PREFIXES.prompt),
          organizationId: ORG_ID,
          projectId: PROJECT_ID,
          promptSetVersionId: setVersionId,
          clusterId,
          personaVersionId: versionId,
          sequence: promptIndex,
          coverageKey: plan.key,
          parentCoverageKey: plan.parentKey,
          promptText,
          normalizedHash: sha256(promptText.toLowerCase()),
          geoCategory: GEO_CATEGORIES[(promptCount + promptIndex) % GEO_CATEGORIES.length]!,
          topicClass:
            plan.stage === "decision"
              ? "brand_entity_authority"
              : plan.stage === "consideration"
                ? "competitive_comparison"
                : "buyer_education",
          promptType: plan.stage === "decision" ? "branded" : "unbranded",
          questionArchetype:
            plan.stage === "decision"
              ? "recommendation"
              : plan.stage === "consideration"
                ? "comparison"
                : "how_to",
          intent:
            plan.stage === "decision"
              ? "Validate a purchase decision"
              : plan.stage === "consideration"
                ? "Evaluate approaches and tradeoffs"
                : "Understand the problem and possible approaches",
          journeyStage: plan.stage,
          businessLine,
          signalTracked:
            plan.stage === "decision"
              ? "brand selection"
              : plan.stage === "consideration"
                ? "solution evaluation"
                : "problem discovery",
          buyerQualifier: name,
          namedEntities: plan.stage === "decision" ? ["Northwind Enterprise Platform"] : [],
          qualityScore: 92,
          rubricScores: {
            categorySpecificity: 14,
            personaContextFit: 14,
            naturalBuyerLanguage: 14,
            funnelCoherence: 18,
            answerValue: 14,
            evidenceSupport: 9,
            distinctiveness: 9,
            total: 92,
          },
          evaluatorExplanation:
            "Deterministic demo prompt grounded in the seeded persona and research signals.",
          researchFactIds: ["fact-001", "fact-004", "fact-008"],
          maximumSimilarity: 0.42,
          reviewStatus: "ready",
          expectedAnswerElements: ["Direct guidance", "Tradeoffs", "Evidence", "Next steps"],
          signalIds: signalIds.slice(0, 3),
        });
      }
    }
    promptCount += plans.length;
  }
  return {
    organizations: 1,
    users: userRows.length,
    projects: 1,
    sources: 1,
    signals: signalIds.length,
    personas: profileNames.length,
    prompts: promptCount,
  };
}

function seededProfile(name: string, ids: string[]): PersonaProfile {
  const insight = (text: string, index = 0): PersonaInsight => ({
    text,
    signalIds: [ids[index % ids.length]!],
    confidence: 0.82,
  });
  return {
    summary: `${name} uses search and AI answers to make, validate, and defend a consequential enterprise decision.`,
    demographics: {
      age: [],
      gender: [],
      income: [],
      education: [],
      geography: [{ label: "United States", value: 100, unit: "percent", signalIds: [ids[11]!] }],
    },
    firmographics: {
      roles: [insight("Technology, operations, security, and strategy leaders")],
      seniority: [insight("Director through executive", 11)],
      departments: [insight("Operations, IT, security, and strategy")],
      industries: [insight("Enterprise and mid-market organizations")],
      companySize: [insight("Organizations with cross-functional buying groups")],
      experience: [insight("Experienced evaluators managing complex decisions")],
    },
    jobsToBeDone: [insight("Build a defensible shortlist", 0)],
    motivations: [insight("Make a confident decision")],
    goals: [insight("Align stakeholders around a practical next step")],
    painPoints: [insight("Generic claims obscure meaningful fit", 1)],
    constraints: [insight("Governance and implementation capacity constrain options", 2)],
    successMeasures: [insight("Measurable operating improvement", 6)],
    decisionCriteria: [insight("Fit, proof, effort, and risk", 3)],
    objections: [insight("Unverified claims cannot support a recommendation")],
    commonQuestions: [insight("Which approach is the best fit?", 5)],
    proofNeeds: [insight("Independent evidence and relevant examples", 4)],
    vocabulary: [insight("defensible shortlist", 7)],
    buyingTriggers: [insight("An urgent workflow problem or replacement decision")],
    channels: [insight("Search and professional networks")],
    communities: [insight("Peer practitioner communities")],
    websites: [insight("Trusted business and technology publications", 10)],
    contentPreferences: [insight("Concise comparison with detailed proof")],
    keywords: [insight("enterprise workflow platform comparison", 8)],
    aiPromptTopics: [insight("compare enterprise workflow solutions", 9)],
  };
}
