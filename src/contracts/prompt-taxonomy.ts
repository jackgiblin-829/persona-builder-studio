import {
  resolvePromptWorkbookProfile,
  type PromptStrategy,
  type TopicClass,
} from "./prompt-strategy";

export type PromptTaxonomySourceRow = {
  promptText: string;
  promptType: string;
  topicClass: string;
  persona: string;
  funnelStage: string;
  businessLine: string;
  region: string;
  pathway: string;
  coverageKey: string;
  parentCoverageKey: string | null;
  questionArchetype: string;
  qualityScore: number;
  reviewStatus?: string;
  evidenceReferences: string[];
  sequence: number;
};

export type PromptTaxonomyTopic = {
  topic: string;
  objective: string;
  audience: string;
  phase: number;
  metric: string;
  promptCount: number;
};

export type PromptTaxonomyPrompt = {
  id: string;
  topic: string;
  prompt: string;
  type: "Branded" | "Unbranded" | "Competitor-Comparative" | "Entity Disambiguation";
  audience: string;
  stage: "Explore" | "Evaluate" | "Choose" | "Trust";
  line: string;
  region: string;
  phase: number;
  signal: string;
  persona: string;
  pathway: string;
  promptId: string;
  parentPromptId: string;
  qualityScore: number;
  reviewStatus: string;
  evidenceReferences: string;
};

export type PromptTaxonomyCompetitor = {
  name: string;
  bucket: string;
  why: string;
  phase: number;
};

export type PromptTaxonomyEntityRisk = {
  issue: string;
  why: string;
  severity: "High" | "Medium" | "Low";
  action: string;
};

export type PromptTaxonomyPlan = {
  brand: string;
  domain: string;
  preparedBy: string;
  preparedAt: string;
  primaryCommercialJob: string;
  trackingSurfaces: string[];
  containsMock: boolean;
  isDraft: boolean;
  construction: Array<{ label: string; text: string }>;
  phasing: Array<{ label: string; text: string }>;
  firstRead: Array<{ label: string; text: string }>;
  topics: PromptTaxonomyTopic[];
  prompts: PromptTaxonomyPrompt[];
  competitors: PromptTaxonomyCompetitor[];
  entityRisks: PromptTaxonomyEntityRisk[];
  quality: {
    sourcePromptCount: number;
    exportedPromptCount: number;
    topicCount: number;
    unbrandedShare: number;
    phaseOneCount: number;
    warnings: string[];
  };
};

export function buildPromptTaxonomyPlan(input: {
  brand: string;
  domain: string;
  primaryMarket: string;
  strategy: PromptStrategy;
  rows: PromptTaxonomySourceRow[];
  containsMock: boolean;
  isDraft?: boolean;
  preparedAt?: Date;
}): PromptTaxonomyPlan {
  const profile = resolvePromptWorkbookProfile(input.strategy, input.primaryMarket);
  const sourceRows = dedupeRows(input.rows);
  const selectedRows = selectRows(sourceRows, 180);
  const phases = assignPhases(selectedRows);
  const topicAssignments = buildTopicAssignments(selectedRows);
  const prompts = selectedRows
    .map((row, index) => {
      const topic = topicAssignments.get(row)!;
      const type = promptTypeLabel(row.promptType);
      return {
        id: `P${String(index + 1).padStart(3, "0")}`,
        topic,
        prompt: row.promptText.trim(),
        type,
        audience: row.persona,
        stage: searchIntentLabel(row.funnelStage, row.topicClass),
        line: row.businessLine || "Brand",
        region: row.region || profile.targetRegions[0] || input.primaryMarket,
        phase: phases.get(row) ?? 3,
        signal: signalLabel(row.topicClass, type),
        persona: row.persona,
        pathway: row.pathway.replace(/decision pathway/gi, "search theme"),
        promptId: row.coverageKey,
        parentPromptId: row.parentCoverageKey ?? "",
        qualityScore: Math.round(row.qualityScore),
        reviewStatus: row.reviewStatus ?? "approved",
        evidenceReferences: row.evidenceReferences.join(" | "),
      } satisfies PromptTaxonomyPrompt;
    })
    .sort(
      (a, b) => a.topic.localeCompare(b.topic) || a.phase - b.phase || a.id.localeCompare(b.id),
    );

  prompts.forEach((prompt, index) => {
    prompt.id = `P${String(index + 1).padStart(3, "0")}`;
  });

  const topics = buildTopics(prompts, profile.primaryCommercialJob);
  const competitors = buildCompetitors(input.strategy, profile.competitorContext);
  const entityRisks = buildEntityRisks(input.strategy, profile.entityRiskRows, input.domain);
  const unbrandedShare =
    prompts.filter((prompt) => prompt.type === "Unbranded").length / Math.max(prompts.length, 1);
  const phaseOneCount = prompts.filter((prompt) => prompt.phase === 1).length;
  const warnings: string[] = [];
  if (prompts.length < 120 || prompts.length > 180) {
    warnings.push(`Prompt count is ${prompts.length}; the recommended planning range is 120–180.`);
  }
  if (topics.length < 10 || topics.length > 16) {
    warnings.push(`Topic count is ${topics.length}; the recommended reporting range is 10–16.`);
  }
  const thinTopics = topics.filter((topic) => topic.promptCount < 6);
  if (thinTopics.length) {
    warnings.push(
      `${thinTopics.length} topic${thinTopics.length === 1 ? " has" : "s have"} fewer than six prompts and should be merged or expanded.`,
    );
  }
  if (unbrandedShare < 0.6 || unbrandedShare > 0.7) {
    warnings.push(
      `Unbranded share is ${Math.round(unbrandedShare * 100)}%; refresh the prompt taxonomy to target 60–70%.`,
    );
  }
  if (phaseOneCount < 40 || phaseOneCount > 70) {
    warnings.push(`Phase 1 contains ${phaseOneCount} prompts; the recommended range is 40–70.`);
  }
  if (competitors.length < 5) {
    warnings.push("Add more competitor context for a stronger share-of-voice benchmark.");
  }
  const unresolvedCount = prompts.filter(
    (prompt) => prompt.reviewStatus === "needs_revision",
  ).length;
  if (input.isDraft) {
    warnings.unshift(
      `Working draft: ${unresolvedCount} prompt${unresolvedCount === 1 ? " requires" : "s require"} another quality pass before client delivery.`,
    );
  }

  return {
    brand: input.brand,
    domain: input.domain,
    preparedBy: profile.preparedBy,
    preparedAt: new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
      input.preparedAt ?? new Date(),
    ),
    primaryCommercialJob: profile.primaryCommercialJob,
    trackingSurfaces: profile.trackingSurfaces,
    containsMock: input.containsMock,
    isDraft: Boolean(input.isDraft),
    construction: [
      {
        label: "Unbranded majority",
        text: "The plan targets 60–70% unbranded prompts so the baseline measures whether the brand is recommended without being named.",
      },
      {
        label: "Persona grounded",
        text: "Every row retains its originating persona, search theme, quality score, and evidence references.",
      },
      {
        label: "Reporting architecture",
        text: "Mandatory brand, discovery, comparison, buyer-education, and reputation classes are paired with product-line topics for readable reporting.",
      },
      {
        label: "Commercial job",
        text: profile.primaryCommercialJob,
      },
    ],
    phasing: [
      {
        label: "Phase 1",
        text: "Entity accuracy, primary unbranded discovery, core comparisons, buyer education, and the main risk checks. Establish this baseline first.",
      },
      {
        label: "Phase 2",
        text: "Broader product-line and persona coverage once the first baseline is stable.",
      },
      {
        label: "Phase 3",
        text: "Long-tail searches and secondary comparisons for expansion after the core programme is running.",
      },
    ],
    firstRead: [
      {
        label: "Run every surface",
        text: `Track the same prompts across ${profile.trackingSurfaces.join(", ")}; answer composition differs by platform.`,
      },
      {
        label: "Expect a low baseline",
        text: "Single-digit presence in unbranded topics is an opportunity signal, not a measurement error.",
      },
      {
        label: "Follow citations",
        text: "Source domains that repeatedly shape answers are the content, digital PR, and authority-building targets.",
      },
      {
        label: "Fix entities early",
        text: "Resolve entity collisions and stale facts alongside the first month; content cannot repair a model that resolves the wrong company.",
      },
    ],
    topics,
    prompts,
    competitors,
    entityRisks,
    quality: {
      sourcePromptCount: input.rows.length,
      exportedPromptCount: prompts.length,
      topicCount: topics.length,
      unbrandedShare,
      phaseOneCount,
      warnings,
    },
  };
}

function dedupeRows(rows: PromptTaxonomySourceRow[]) {
  const seen = new Set<string>();
  return rows.filter((row) => {
    const key = row.promptText
      .trim()
      .toLowerCase()
      .replace(/[?!.]+$/, "");
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function selectRows(rows: PromptTaxonomySourceRow[], maximum: number) {
  if (rows.length <= maximum) return [...rows];
  const groups = new Map<string, PromptTaxonomySourceRow[]>();
  for (const row of rows) {
    const key = topicLabelFor(row);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  for (const group of groups.values()) group.sort((a, b) => rowPriority(b) - rowPriority(a));
  const selected: PromptTaxonomySourceRow[] = [];
  let index = 0;
  while (selected.length < maximum) {
    let added = false;
    for (const group of groups.values()) {
      const row = group[index];
      if (!row || selected.length >= maximum) continue;
      selected.push(row);
      added = true;
    }
    if (!added) break;
    index++;
  }
  return selected.sort((a, b) => a.sequence - b.sequence);
}

function rowPriority(row: PromptTaxonomySourceRow) {
  const topicWeight: Record<string, number> = {
    brand_entity_authority: 8,
    unbranded_category_discovery: 10,
    competitive_comparison: 9,
    buyer_education: 8,
    product_line_use_cases: 7,
    reputation_risk: 8,
  };
  const stageWeight: Record<string, number> = { decision: 3, consideration: 2, awareness: 1 };
  return (
    (topicWeight[row.topicClass] ?? 5) * 100 +
    (stageWeight[row.funnelStage] ?? 1) * 10 +
    row.qualityScore / 10
  );
}

function assignPhases(rows: PromptTaxonomySourceRow[]) {
  const ranked = [...rows].sort((a, b) => rowPriority(b) - rowPriority(a));
  const phaseOneTarget = Math.min(
    ranked.length,
    Math.max(40, Math.min(70, Math.round(ranked.length * 0.4))),
  );
  const remaining = Math.max(0, ranked.length - phaseOneTarget);
  const phaseTwoTarget = Math.round(remaining * 0.6);
  const result = new Map<PromptTaxonomySourceRow, number>();
  ranked.forEach((row, index) => {
    result.set(row, index < phaseOneTarget ? 1 : index < phaseOneTarget + phaseTwoTarget ? 2 : 3);
  });
  return result;
}

function topicLabelFor(row: PromptTaxonomySourceRow) {
  const topicClass = row.topicClass as TopicClass;
  if (topicClass === "brand_entity_authority") return "Brand & Entity Authority";
  if (topicClass === "unbranded_category_discovery") return "Unbranded Category Discovery";
  if (topicClass === "competitive_comparison") return "Competitive Comparison";
  if (topicClass === "reputation_risk") return "Reputation, Reviews & Risk";
  const line = titleCase(row.businessLine || "Category");
  if (topicClass === "buyer_education") return `${line} Buyer Education`;
  if (topicClass === "product_line_use_cases") return `${line} Use Cases`;
  return `${line} Buyer Questions`;
}

function buildTopicAssignments(rows: PromptTaxonomySourceRow[]) {
  const fixed = [
    "Brand & Entity Authority",
    "Unbranded Category Discovery",
    "Competitive Comparison",
  ];
  const last = "Reputation, Reviews & Risk";
  const labels = new Map<PromptTaxonomySourceRow, string>();
  for (const row of rows) {
    const label = topicLabelFor(row);
    labels.set(row, label);
  }

  const counts = () => {
    const result = new Map<string, number>();
    for (const label of labels.values()) result.set(label, (result.get(label) ?? 0) + 1);
    return result;
  };

  const dynamicRows = rows.filter((row) => {
    const label = labels.get(row)!;
    return !fixed.includes(label) && label !== last;
  });
  const byLine = new Map<string, PromptTaxonomySourceRow[]>();
  for (const row of dynamicRows) {
    const key = row.businessLine.trim().toLowerCase();
    byLine.set(key, [...(byLine.get(key) ?? []), row]);
  }
  for (const lineRows of byLine.values()) {
    const lineCounts = new Map<string, number>();
    for (const row of lineRows) {
      const label = labels.get(row)!;
      lineCounts.set(label, (lineCounts.get(label) ?? 0) + 1);
    }
    if (lineCounts.size > 1 && [...lineCounts.values()].every((count) => count < 6)) {
      const merged = `${titleCase(lineRows[0]!.businessLine)} Buyer Questions`;
      lineRows.forEach((row) => labels.set(row, merged));
    }
  }

  while (counts().size < 10) {
    const candidate = [...counts().entries()]
      .filter(([label, count]) => !fixed.includes(label) && label !== last && count >= 12)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
    if (!candidate) break;
    const [label] = candidate;
    const group = rows.filter((row) => labels.get(row) === label);
    const alternate = label.endsWith("Use Cases")
      ? `${label.replace(/ Use Cases$/, "")} Implementation & Adoption`
      : label.endsWith("Buyer Education")
        ? `${label.replace(/ Buyer Education$/, "")} Price, Value & Procurement`
        : `${label} — Extended Coverage`;
    group.forEach((row, index) => {
      if (index % 2 === 1) labels.set(row, alternate);
    });
  }

  const allCounts = counts();
  const dynamic = [...allCounts.keys()]
    .filter((label) => !fixed.includes(label) && label !== last)
    .sort((a, b) => a.localeCompare(b));
  const keepDynamic = dynamic
    .sort((a, b) => (allCounts.get(b) ?? 0) - (allCounts.get(a) ?? 0) || a.localeCompare(b))
    .slice(0, 11);
  const collapsed = dynamic.length > keepDynamic.length;
  if (collapsed) {
    for (const row of dynamicRows) {
      if (!keepDynamic.includes(labels.get(row)!)) {
        labels.set(row, "Additional Product & Buyer Questions");
      }
    }
  }

  const orderedLabels = [
    ...fixed.filter((label) => [...labels.values()].includes(label)),
    ...[...new Set([...labels.values()])]
      .filter((label) => !fixed.includes(label) && label !== last)
      .sort((a, b) => a.localeCompare(b)),
    ...([...labels.values()].includes(last) ? [last] : []),
  ];
  const numbered = new Map(
    orderedLabels.map((label, index) => [label, `${String(index + 1).padStart(2, "0")}. ${label}`]),
  );
  return new Map(rows.map((row) => [row, numbered.get(labels.get(row)!)!]));
}

function buildTopics(prompts: PromptTaxonomyPrompt[], primaryCommercialJob: string) {
  const grouped = new Map<string, PromptTaxonomyPrompt[]>();
  for (const prompt of prompts)
    grouped.set(prompt.topic, [...(grouped.get(prompt.topic) ?? []), prompt]);
  return [...grouped.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([topic, rows]) => {
      const label = topic.replace(/^\d{2}\.\s*/, "");
      const audience = mode(rows.map((row) => row.audience));
      const isBrand = label.includes("Brand & Entity");
      const isDiscovery = label.includes("Unbranded Category");
      const isComparison = label.includes("Competitive Comparison");
      const isRisk = label.includes("Reputation");
      const isEducation = label.includes("Education");
      return {
        topic,
        objective: isBrand
          ? "Keep leadership, ownership, category, and entity relationships accurate across answer engines."
          : isDiscovery
            ? primaryCommercialJob
            : isComparison
              ? "Understand which alternatives enter the shortlist and how answer engines frame the tradeoffs."
              : isRisk
                ? "Detect negative framing, stale claims, and category backlash before they shape buyer trust."
                : isEducation
                  ? "Own the questions buyers ask before they know which brands belong on the shortlist."
                  : `Build recommendation authority for ${label.toLowerCase()} among the buyers most likely to act.`,
        audience,
        phase: Math.min(...rows.map((row) => row.phase)),
        metric: isBrand
          ? "Presence rate plus factual accuracy"
          : isDiscovery
            ? "Share of voice vs. named competitor set"
            : isComparison
              ? "Head-to-head win rate and comparison sentiment"
              : isRisk
                ? "Sentiment trend and negative-source concentration"
                : isEducation
                  ? "Citation share of the client domain"
                  : "Citation share and recommendation presence",
        promptCount: rows.length,
      } satisfies PromptTaxonomyTopic;
    });
}

function buildCompetitors(strategy: PromptStrategy, lines: string[]) {
  const parsed = lines.map((line) => line.split("|").map((item) => item.trim()));
  const custom = parsed
    .filter((parts) => parts.length >= 3 && parts[0])
    .map((parts) => ({
      name: parts[0]!,
      bucket: parts[1] || strategy.businessLines[0] || "Brand",
      why: parts[2] || "Named alternative in the buyer consideration set.",
      phase: clampPhase(Number(parts[3] || 1)),
    }));
  if (custom.length) return custom;
  return strategy.competitors.map((name, index) => ({
    name,
    bucket: strategy.businessLines[index % Math.max(strategy.businessLines.length, 1)] || "Brand",
    why: "Named alternative used to benchmark share of voice, recommendation position, and comparison framing.",
    phase: index < 8 ? 1 : 2,
  }));
}

function buildEntityRisks(strategy: PromptStrategy, lines: string[], domain: string) {
  const custom = lines
    .map((line) => line.split("|").map((item) => item.trim()))
    .filter((parts) => parts.length >= 4 && parts[0])
    .map((parts) => ({
      issue: parts[0]!,
      severity: severity(parts[1]),
      why: parts[2]!,
      action: parts.slice(3).join(" | "),
    }));
  if (custom.length) return custom;
  const risks: PromptTaxonomyEntityRisk[] = strategy.entityCollisions.map((collision) => ({
    issue: `${strategy.canonicalBrand} / ${collision} collision`,
    why: "Unqualified questions may resolve to the wrong company or blend facts from two entities.",
    severity: "High",
    action: `Track a disambiguation prompt and declare the relationship through Organization schema, alternateName, and sameAs references on ${domain}.`,
  }));
  if (strategy.aliases.length) {
    risks.push({
      issue: "Brand-name variants",
      why: `Answer engines may treat ${strategy.aliases.join(", ")} as separate entities or fail to consolidate their authority.`,
      severity: "Medium",
      action:
        "Standardize the primary surface form and declare every approved alias in structured data and authoritative third-party profiles.",
    });
  }
  if (strategy.freshnessFacts.length) {
    risks.push({
      issue: "Freshness-sensitive facts",
      why: `${strategy.freshnessFacts.join(", ")} can become stale across model training windows and third-party databases.`,
      severity: "High",
      action:
        "Track factual prompts weekly and update the canonical site, structured data, and major third-party profiles when facts change.",
    });
  }
  const defaults: PromptTaxonomyEntityRisk[] = [
    {
      issue: "Canonical domain authority",
      why: `Models may cite secondary profiles instead of ${domain}, weakening attribution and factual consistency.`,
      severity: "Medium",
      action:
        "Use Organization schema, a complete sameAs block, and consistent parent-brand language on the canonical domain.",
    },
    {
      issue: "Third-party fact consistency",
      why: "Conflicting leadership, ownership, category, or scale claims cause models to hedge or average incompatible facts.",
      severity: "Medium",
      action:
        "Reconcile the canonical facts across LinkedIn, Wikidata, major industry databases, and high-authority media profiles.",
    },
    {
      issue: "Structured entity markup",
      why: "Thin or missing structured data makes it harder for answer engines to connect the brand, aliases, products, and authoritative profiles.",
      severity: "Medium",
      action:
        "Add and validate Organization, Product or Service, parentOrganization, alternateName, and sameAs markup where applicable.",
    },
  ];
  for (const fallback of defaults) {
    if (risks.length >= 3) break;
    risks.push(fallback);
  }
  return risks.slice(0, 8);
}

function promptTypeLabel(value: string): PromptTaxonomyPrompt["type"] {
  if (value === "branded") return "Branded";
  if (value === "competitor_comparative") return "Competitor-Comparative";
  if (value === "entity_disambiguation") return "Entity Disambiguation";
  return "Unbranded";
}

function searchIntentLabel(value: string, topicClass: string): PromptTaxonomyPrompt["stage"] {
  if (topicClass === "reputation_risk") return "Trust";
  if (value === "decision") return "Choose";
  if (value === "consideration") return "Evaluate";
  return "Explore";
}

function signalLabel(topicClass: string, type: PromptTaxonomyPrompt["type"]) {
  if (type === "Entity Disambiguation") return "Entity resolution";
  if (topicClass === "brand_entity_authority") return "Brand accuracy";
  if (topicClass === "unbranded_category_discovery") return "Demand discovery";
  if (topicClass === "competitive_comparison") return "Competitive displacement";
  if (topicClass === "buyer_education") return "Category education";
  if (topicClass === "reputation_risk") {
    return type === "Branded" ? "Sentiment risk" : "Category sentiment";
  }
  return "Positioning ownership";
}

function severity(value: string | undefined): PromptTaxonomyEntityRisk["severity"] {
  const normalized = value?.toLowerCase();
  return normalized === "high" ? "High" : normalized === "low" ? "Low" : "Medium";
}

function clampPhase(value: number) {
  return Number.isFinite(value) ? Math.max(1, Math.min(3, Math.round(value))) : 1;
}

function mode(values: string[]) {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return (
    [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ??
    "Priority buyer"
  );
}

function titleCase(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}
