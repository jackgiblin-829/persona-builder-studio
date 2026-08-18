import "server-only";
import { and, eq, inArray, max } from "drizzle-orm";
import { getOpenAIAdapter } from "@/adapters/openai";
import {
  getSparktoroAdapter,
  REQUIRED_SPARKTORO_SECTIONS,
  SPARKTORO_MAX_REPORT_COST,
  SPARKTORO_SECTIONS,
  type SparktoroSection,
} from "@/adapters/sparktoro";
import { db } from "@/db/client";
import {
  generationRuns,
  personas,
  personaVersions,
  personaVersionSignals,
  projects,
  researchSignals,
  sparkReports,
  sparkReportSections,
  type PersonaProfile,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { sparkReportHash } from "@/lib/sparktoro-report";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { PERSONA_GENERATION, renderTemplate } from "@/prompts/registry";
import { personaGenerationSchema, SCHEMA_VERSION, type PersonaGeneration } from "@/prompts/schemas";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

registerJob(JOB_TYPES.generatePersonas, async ({ job }) => {
  const runId = String(job.payload.runId ?? "");
  if (!runId) throw new AppError("validation", "generate_personas requires runId");
  const [run] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId)).limit(1);
  if (!run) throw new AppError("not_found", "Generation run no longer exists");
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
  if (!project) throw new AppError("not_found", "Project no longer exists");

  await updateRun(runId, {
    status: "running",
    stage: "processing_sources",
    progress: 5,
    startedAt: new Date(),
    errorMessage: null,
  });
  try {
    const firstParty = await db
      .select()
      .from(researchSignals)
      .where(
        and(
          eq(researchSignals.projectId, project.id),
          eq(researchSignals.sourceKind, "first_party"),
        ),
      );
    if (!firstParty.length)
      throw new AppError("validation", "No completed first-party research signals are available.");

    await updateRun(runId, { stage: "researching_audience", progress: 15 });
    const warnings: string[] = [];
    const report = await getOrCreateFullSparkReport(project, job.id, warnings, async (progress) => {
      await updateRun(runId, { progress });
    });
    await materializeSparkSignals(project.id, project.organizationId, report.id, report.mode);

    const currentSparkSignals = await db
      .select({ signal: researchSignals })
      .from(researchSignals)
      .innerJoin(
        sparkReportSections,
        eq(sparkReportSections.id, researchSignals.sparkReportSectionId),
      )
      .where(
        and(eq(researchSignals.projectId, project.id), eq(sparkReportSections.reportId, report.id)),
      );
    // Older immutable persona versions may still reference signals from prior
    // reports. Preserve those rows, but synthesize only from this run's report.
    const signals = [...firstParty, ...currentSparkSignals.map((row) => row.signal)];
    await updateRun(runId, { stage: "identifying_segments", progress: 72, warnings });
    const { adapter, mode } = await getOpenAIAdapter(project.organizationId);
    const result = await withVendorUsage(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        vendor: "openai",
        operation: "persona_generation",
        mode,
        jobId: job.id,
      },
      () =>
        adapter.generateStructured({
          templateId: PERSONA_GENERATION.id,
          templateVersion: PERSONA_GENERATION.version,
          schemaVersion: SCHEMA_VERSION,
          system: PERSONA_GENERATION.system,
          user: renderTemplate(PERSONA_GENERATION, {
            project_context: JSON.stringify({
              name: project.name,
              domain: project.canonicalDomain,
              productOrService: project.description,
              market: project.primaryMarket,
              locale: project.languageLocale,
              audienceDescription: project.sparktoroAudienceDescription,
            }),
            research_signals: JSON.stringify(
              signals.slice(0, 900).map((signal) => ({
                id: signal.id,
                sourceKind: signal.sourceKind,
                category: signal.category,
                text: signal.displayText,
                value: signal.structuredValue,
                confidence: signal.confidence,
              })),
            ),
          }),
          schema: personaGenerationSchema,
          schemaName: "ProjectPersonaGeneration",
          jsonSchema: toStrictJsonSchema(personaGenerationSchema, "ProjectPersonaGeneration"),
          modelTier: PERSONA_GENERATION.modelTier,
          mockContext: {
            signals: signals.map((signal) => ({
              id: signal.id,
              category: signal.category,
              displayText: signal.displayText,
            })),
          },
        }),
      (value) => ({
        retryCount: value.attempts - 1,
        tokensIn: value.tokensIn,
        tokensOut: value.tokensOut,
        costCents: value.costCents,
      }),
    );
    const sanitized = sanitizePersonaReferences(
      result.data,
      signals.map((signal) => ({ id: signal.id, category: signal.category })),
    );
    if (sanitized.removedReferences) {
      warnings.push(
        `Removed ${sanitized.removedReferences} unsupported evidence reference${sanitized.removedReferences === 1 ? "" : "s"} returned by OpenAI.`,
      );
    }
    if (sanitized.droppedInsights) {
      warnings.push(
        `Omitted ${sanitized.droppedInsights} insight${sanitized.droppedInsights === 1 ? "" : "s"} that had no valid supporting evidence.`,
      );
    }
    validatePersonaReferences(
      sanitized.output,
      signals.map((signal) => ({ id: signal.id, category: signal.category })),
    );
    await updateRun(runId, { stage: "creating_personas", progress: 86 });
    const versionIds = await atomicallyReplacePersonas({
      project,
      runId,
      output: sanitized.output,
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      dataOrigin: result.dataOrigin,
      initiatedByUserId: run.initiatedByUserId,
    });
    await updateRun(runId, {
      status: warnings.length ? "completed_with_warnings" : "completed",
      stage: "ready",
      progress: 100,
      warnings,
      resultingVersionIds: versionIds,
      finishedAt: new Date(),
    });
    return {
      status: warnings.length ? "partially_succeeded" : "succeeded",
      result: { personaVersionIds: versionIds, warnings },
    };
  } catch (error) {
    await updateRun(runId, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message.slice(0, 3000) : String(error),
      finishedAt: new Date(),
    });
    throw error;
  }
});

async function updateRun(id: string, values: Partial<typeof generationRuns.$inferInsert>) {
  await db
    .update(generationRuns)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(generationRuns.id, id));
}

async function getOrCreateFullSparkReport(
  project: typeof projects.$inferSelect,
  jobId: string,
  warnings: string[],
  onProgress: (value: number) => Promise<void>,
) {
  const { adapter, mode } = await getSparktoroAdapter(project.organizationId);
  const inputHash = sparkReportHash(
    project.sparktoroAudienceDescription,
    project.primaryMarket,
    project.languageLocale,
    mode,
  );
  const [cached] = await db
    .select()
    .from(sparkReports)
    .where(
      and(
        eq(sparkReports.organizationId, project.organizationId),
        eq(sparkReports.inputHash, inputHash),
        inArray(sparkReports.status, ["completed", "completed_with_warnings"]),
      ),
    )
    .limit(1);
  if (cached) return { ...cached, mode };

  // A failed or interrupted report must not occupy the unique cache key. Its
  // sections and materialized signals cascade away before the intentional retry.
  const [stale] = await db
    .select({ id: sparkReports.id })
    .from(sparkReports)
    .where(
      and(
        eq(sparkReports.organizationId, project.organizationId),
        eq(sparkReports.inputHash, inputHash),
      ),
    )
    .limit(1);
  if (stale) await db.delete(sparkReports).where(eq(sparkReports.id, stale.id));

  const balance = await withVendorUsage(
    {
      organizationId: project.organizationId,
      projectId: project.id,
      vendor: "sparktoro",
      operation: "credit_preflight",
      mode,
      jobId,
    },
    () => adapter.getCreditBalance(),
    (value) => ({ credits: value.creditsUsed }),
  );
  if (balance.data.creditsRemaining < SPARKTORO_MAX_REPORT_COST) {
    throw new AppError(
      "vendor_credit_exhausted",
      `SparkToro has ${balance.data.creditsRemaining} credits; this full report may use up to ${SPARKTORO_MAX_REPORT_COST}.`,
    );
  }
  const reportId = newId(ID_PREFIXES.sparkReport);
  await db.insert(sparkReports).values({
    id: reportId,
    organizationId: project.organizationId,
    projectId: project.id,
    inputHash,
    audienceDescription: project.sparktoroAudienceDescription,
    market: project.primaryMarket,
    locale: project.languageLocale,
    status: "processing",
    creditsEstimated: SPARKTORO_MAX_REPORT_COST,
    creditsRemainingAtStart: balance.data.creditsRemaining,
  });
  const created = await withVendorUsage(
    {
      organizationId: project.organizationId,
      projectId: project.id,
      vendor: "sparktoro",
      operation: "create_report",
      mode,
      jobId,
      requestHash: inputHash,
    },
    () =>
      adapter.createAudienceReport({
        description: project.sparktoroAudienceDescription,
        location: project.primaryMarket.toLowerCase() as "us" | "ca" | "uk",
      }),
    (value) => ({ credits: value.creditsUsed }),
  );
  await db
    .update(sparkReports)
    .set({
      vendorReportId: created.data.reportId,
      creditsUsed: created.creditsUsed,
      updatedAt: new Date(),
    })
    .where(eq(sparkReports.id, reportId));

  let creditsUsed = created.creditsUsed;
  const failures = new Map<SparktoroSection, string>();
  for (let index = 0; index < SPARKTORO_SECTIONS.length; index++) {
    const section = SPARKTORO_SECTIONS[index]!;
    const sectionId = newId(ID_PREFIXES.sparkReportSection);
    await db.insert(sparkReportSections).values({
      id: sectionId,
      organizationId: project.organizationId,
      projectId: project.id,
      reportId,
      section,
      status: "processing",
    });
    try {
      const value = await withVendorUsage(
        {
          organizationId: project.organizationId,
          projectId: project.id,
          vendor: "sparktoro",
          operation: `section:${section}`,
          mode,
          jobId,
          requestHash: inputHash,
        },
        () => adapter.getSection({ reportId: created.data.reportId, section }),
        (result) => ({ credits: result.creditsUsed, retryCount: (result.attempts ?? 1) - 1 }),
      );
      creditsUsed += value.creditsUsed;
      await db
        .update(sparkReportSections)
        .set({
          status: "completed",
          normalized: value.data.normalized,
          rawResponse: value.raw,
          creditsUsed: value.creditsUsed,
          retryCount: (value.attempts ?? 1) - 1,
          fetchedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(sparkReportSections.id, sectionId));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.set(section, message);
      await db
        .update(sparkReportSections)
        .set({ status: "failed", errorMessage: message.slice(0, 2000), updatedAt: new Date() })
        .where(eq(sparkReportSections.id, sectionId));
    }
    await onProgress(20 + Math.round(((index + 1) / SPARKTORO_SECTIONS.length) * 45));
  }
  const missingRequired = REQUIRED_SPARKTORO_SECTIONS.filter((section) => failures.has(section));
  if (missingRequired.length) {
    await db
      .update(sparkReports)
      .set({
        status: "failed",
        creditsUsed,
        errorMessage: `Required sections failed: ${missingRequired.join(", ")}`,
        updatedAt: new Date(),
      })
      .where(eq(sparkReports.id, reportId));
    throw new AppError(
      "vendor_unavailable",
      `Required SparkToro sections failed: ${missingRequired.join(", ")}`,
    );
  }
  for (const [section, message] of failures) warnings.push(`${section}: ${message}`);
  await db
    .update(sparkReports)
    .set({
      status: failures.size ? "completed_with_warnings" : "completed",
      creditsUsed,
      updatedAt: new Date(),
    })
    .where(eq(sparkReports.id, reportId));
  const [report] = await db
    .select()
    .from(sparkReports)
    .where(eq(sparkReports.id, reportId))
    .limit(1);
  if (!report) throw new AppError("internal", "SparkToro report disappeared after creation");
  return { ...report, mode };
}

export async function materializeSparkSignals(
  projectId: string,
  organizationId: string,
  reportId: string,
  mode: "mock" | "live",
) {
  const sections = await db
    .select()
    .from(sparkReportSections)
    .where(
      and(eq(sparkReportSections.reportId, reportId), eq(sparkReportSections.status, "completed")),
    );
  const sectionIds = sections.map((section) => section.id);
  if (!sectionIds.length) return;
  const [existing] = await db
    .select({ id: researchSignals.id })
    .from(researchSignals)
    .where(
      and(
        eq(researchSignals.projectId, projectId),
        inArray(researchSignals.sparkReportSectionId, sectionIds),
      ),
    )
    .limit(1);
  // Cached reports reuse their normalized signals. Deleting them would break
  // the immutable evidence links held by already-published persona versions.
  if (existing) return;

  const values: (typeof researchSignals.$inferInsert)[] = [];
  for (const section of sections) {
    for (const signal of normalizedSignals(section.section, section.normalized)) {
      values.push({
        id: newId(ID_PREFIXES.researchSignal),
        organizationId,
        projectId,
        sourceKind: "sparktoro",
        sparkReportSectionId: section.id,
        category: signal.category,
        displayText: signal.text,
        structuredValue: signal.value,
        provenance: "externally_supported_aggregate",
        sourceLocation: `SparkToro / ${section.section}`,
        confidence: 0.82,
        dataOrigin: mode,
      });
    }
  }
  if (values.length) await db.insert(researchSignals).values(values);
}

export function normalizedSignals(section: string, normalized: Record<string, unknown>) {
  const result: { category: string; text: string; value: Record<string, unknown> }[] = [];
  if (section === "demographics") {
    const distributions = normalized.distributions;
    if (distributions && typeof distributions === "object" && !Array.isArray(distributions)) {
      for (const [field, buckets] of Object.entries(distributions)) {
        if (!Array.isArray(buckets)) continue;
        for (const bucket of buckets.slice(0, 30)) {
          if (!bucket || typeof bucket !== "object") continue;
          const row = bucket as Record<string, unknown>;
          const label = String(row.name ?? row.label ?? "Unknown");
          const value = Number(row.value ?? row.percentage ?? 0);
          result.push({
            category: `demographic:${field}`,
            text: `${field.replaceAll("_", " ")}: ${label} (${value})`,
            value: { field, label, value, unit: "percent" },
          });
        }
      }
      return result;
    }
  }
  if (section === "market_size") {
    const value = Number(normalized.estimated_population ?? normalized.estimatedSize ?? 0);
    return [
      {
        category: "market_size",
        text: `Estimated addressable audience: ${value.toLocaleString("en-US")}`,
        value: { estimatedPopulation: value },
      },
    ];
  }
  const items = Array.isArray(normalized.items) ? normalized.items : [];
  for (const item of items.slice(0, 60)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const label = firstString(row, [
      "label",
      "name",
      "keyword",
      "domain",
      "title",
      "handle",
      "subreddit",
      "prompt",
      "topic",
      "brand",
    ]);
    if (!label) continue;
    result.push({ category: `sparktoro:${section}`, text: label, value: row });
  }
  return result;
}

function firstString(row: Record<string, unknown>, keys: string[]) {
  for (const key of keys) if (typeof row[key] === "string" && row[key]) return row[key] as string;
  return null;
}

/**
 * Structured Outputs can guarantee the citation field shape, but the model can
 * still copy an ID incorrectly. Keep valid references, remove unsupported
 * references, and omit only an insight that would otherwise have no evidence.
 */
export function sanitizePersonaReferences(
  output: PersonaGeneration,
  signals: { id: string; category: string }[],
) {
  const allowed = new Set(signals.map((signal) => signal.id));
  const demographic = new Set(
    signals
      .filter((signal) => signal.category.startsWith("demographic:"))
      .map((signal) => signal.id),
  );
  let removedReferences = 0;
  let droppedInsights = 0;

  const sanitize = (value: unknown, demographicScope = false): unknown => {
    if (Array.isArray(value)) {
      return value.map((item) => sanitize(item, demographicScope)).filter((item) => item !== null);
    }
    if (!value || typeof value !== "object") return value;
    const row = value as Record<string, unknown>;
    if (Array.isArray(row.signal_ids)) {
      const validSet = demographicScope ? demographic : allowed;
      const original = row.signal_ids.filter((id): id is string => typeof id === "string");
      const signalIds = [...new Set(original.filter((id) => validSet.has(id)))];
      removedReferences += original.length - signalIds.length;
      if (!signalIds.length) {
        droppedInsights++;
        return null;
      }
      return { ...row, signal_ids: signalIds };
    }
    return Object.fromEntries(
      Object.entries(row).map(([key, child]) => [
        key,
        sanitize(child, demographicScope || key === "demographics"),
      ]),
    );
  };

  return {
    output: sanitize(structuredClone(output)) as PersonaGeneration,
    removedReferences,
    droppedInsights,
  };
}

function validatePersonaReferences(
  output: PersonaGeneration,
  signals: { id: string; category: string }[],
) {
  const allowed = new Set(signals.map((signal) => signal.id));
  const demographic = new Set(
    signals
      .filter((signal) => signal.category.startsWith("demographic:"))
      .map((signal) => signal.id),
  );
  for (const persona of output.personas) {
    if (/^[A-Z][a-z]+ [A-Z][a-z]+$/.test(persona.name))
      throw new AppError(
        "schema_validation",
        `Persona name “${persona.name}” looks like a fictional individual.`,
      );
    const cited = collectSignalIds(persona);
    const invalid = cited.filter((id) => !allowed.has(id));
    if (invalid.length)
      throw new AppError(
        "schema_validation",
        `Persona ${persona.name} cited unknown research signals.`,
      );
    for (const distributions of Object.values(persona.demographics)) {
      for (const row of distributions) {
        if (row.signal_ids.some((id) => !demographic.has(id))) {
          throw new AppError(
            "schema_validation",
            `Persona ${persona.name} used a non-SparkToro demographic reference.`,
          );
        }
      }
    }
  }
}

function collectSignalIds(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectSignalIds);
  if (!value || typeof value !== "object") return [];
  const row = value as Record<string, unknown>;
  return [
    ...(Array.isArray(row.signal_ids)
      ? row.signal_ids.filter((id): id is string => typeof id === "string")
      : []),
    ...Object.entries(row)
      .filter(([key]) => key !== "signal_ids")
      .flatMap(([, child]) => collectSignalIds(child)),
  ];
}

function toProfile(persona: PersonaGeneration["personas"][number]): PersonaProfile {
  const insight = (rows: { text: string; signal_ids: string[]; confidence: number }[]) =>
    rows.map((row) => ({ text: row.text, signalIds: row.signal_ids, confidence: row.confidence }));
  const distribution = (
    rows: {
      label: string;
      value: number;
      unit: "percent" | "index" | "count";
      signal_ids: string[];
    }[],
  ) =>
    rows.map((row) => ({
      label: row.label,
      value: row.value,
      unit: row.unit,
      signalIds: row.signal_ids,
    }));
  return {
    summary: persona.summary,
    presentation: {
      role: insight([persona.deck_profile.role])[0]!,
      industry: insight([persona.deck_profile.industry])[0]!,
      expertiseLevel: insight([persona.deck_profile.expertise_level])[0]!,
      tone: insight([persona.deck_profile.tone])[0]!,
      povLens: insight([persona.deck_profile.pov_lens])[0]!,
      caresAbout: insight(persona.deck_profile.cares_about),
      neverSay: insight(persona.deck_profile.never_say),
      contentBestSuitedFor: insight(persona.deck_profile.content_best_suited_for),
    },
    demographics: {
      age: distribution(persona.demographics.age),
      gender: distribution(persona.demographics.gender),
      income: distribution(persona.demographics.income),
      education: distribution(persona.demographics.education),
      geography: distribution(persona.demographics.geography),
    },
    firmographics: {
      roles: insight(persona.firmographics.roles),
      seniority: insight(persona.firmographics.seniority),
      departments: insight(persona.firmographics.departments),
      industries: insight(persona.firmographics.industries),
      companySize: insight(persona.firmographics.company_size),
      experience: insight(persona.firmographics.experience),
    },
    jobsToBeDone: insight(persona.jobs_to_be_done),
    motivations: insight(persona.motivations),
    goals: insight(persona.goals),
    painPoints: insight(persona.pain_points),
    constraints: insight(persona.constraints),
    successMeasures: insight(persona.success_measures),
    decisionCriteria: insight(persona.decision_criteria),
    objections: insight(persona.objections),
    commonQuestions: insight(persona.common_questions),
    proofNeeds: insight(persona.proof_needs),
    vocabulary: insight(persona.vocabulary),
    buyingTriggers: insight(persona.buying_triggers),
    channels: insight(persona.channels),
    communities: insight(persona.communities),
    websites: insight(persona.websites),
    contentPreferences: insight(persona.content_preferences),
    keywords: insight(persona.keywords),
    aiPromptTopics: insight(persona.ai_prompt_topics),
  };
}

async function atomicallyReplacePersonas(input: {
  project: typeof projects.$inferSelect;
  runId: string;
  output: PersonaGeneration;
  modelProvider: string;
  modelId: string;
  dataOrigin: "mock" | "live";
  initiatedByUserId: string | null;
}) {
  const existing = await db.select().from(personas).where(eq(personas.projectId, input.project.id));
  const versionIds: string[] = [];
  await db.transaction(async (tx) => {
    const activeIds: string[] = [];
    for (const generated of input.output.personas) {
      let persona = existing.find((item) => item.slug === generated.slug);
      if (!persona) {
        const [created] = await tx
          .insert(personas)
          .values({
            id: newId(ID_PREFIXES.persona),
            organizationId: input.project.organizationId,
            projectId: input.project.id,
            name: generated.name,
            slug: generated.slug,
          })
          .returning();
        if (!created) throw new AppError("internal", "Could not create persona");
        persona = created;
      }
      const [latest] = await tx
        .select({ value: max(personaVersions.version) })
        .from(personaVersions)
        .where(eq(personaVersions.personaId, persona.id));
      const versionId = newId(ID_PREFIXES.personaVersion);
      const profile = toProfile(generated);
      await tx.insert(personaVersions).values({
        id: versionId,
        organizationId: input.project.organizationId,
        projectId: input.project.id,
        personaId: persona.id,
        generationRunId: input.runId,
        version: (latest?.value ?? 0) + 1,
        name: generated.name,
        description: generated.description,
        profile,
        sourceRevision: input.project.sourceRevision,
        overallConfidence: generated.confidence,
        modelProvider: input.modelProvider,
        modelId: input.modelId,
        promptTemplateVersion: PERSONA_GENERATION.version,
        schemaVersion: SCHEMA_VERSION,
        dataOrigin: input.dataOrigin,
        parentVersionId: persona.currentVersionId,
        createdByUserId: input.initiatedByUserId,
      });
      const signalIds = [...new Set(collectSignalIds(generated))];
      for (const signalId of signalIds) {
        await tx.insert(personaVersionSignals).values({
          id: newId(ID_PREFIXES.personaVersionSignal),
          organizationId: input.project.organizationId,
          personaVersionId: versionId,
          signalId,
          section: "profile",
        });
      }
      await tx
        .update(personas)
        .set({
          name: generated.name,
          currentVersionId: versionId,
          archivedAt: null,
          updatedAt: new Date(),
        })
        .where(eq(personas.id, persona.id));
      activeIds.push(persona.id);
      versionIds.push(versionId);
    }
    const toArchive = existing
      .filter((item) => !activeIds.includes(item.id))
      .map((item) => item.id);
    if (toArchive.length)
      await tx
        .update(personas)
        .set({ archivedAt: new Date(), updatedAt: new Date() })
        .where(inArray(personas.id, toArchive));
    await tx
      .update(projects)
      .set({ activePersonaRevision: input.project.sourceRevision, updatedAt: new Date() })
      .where(eq(projects.id, input.project.id));
  });
  return versionIds;
}
