"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import { requireOrgAccess, requireProjectAccess } from "@/lib/auth/context";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  applyPromptStrategySuggestions,
  createProject,
  deleteProject,
  projectInputSchema,
  promptStrategyInputSchema,
  updateAudienceDescription,
  updatePromptStrategy,
} from "@/services/projects";
import {
  approveCurrentPromptLibrary,
  editPromptText,
  regenerateSinglePrompt,
  setPromptReviewStatus,
} from "@/services/prompts";
import { approveMarketResearchBrief, startMarketResearch } from "@/services/market-research";
import {
  createSourceFromTranscript,
  createSourcesFromUploads,
  retrySource,
  sourceInputSchema,
} from "@/services/sources";
import {
  personaEditSchema,
  savePersonaVersion,
  startPersonaGeneration,
  startPromptGeneration,
} from "@/services/studio";
import { runAction, type ActionState } from "./types";

const createSchema = projectInputSchema.extend({ organizationId: z.string().min(1) });
const projectSchema = z.object({ projectId: z.string().min(1) });

export async function createProjectAction(_previous: ActionState, formData: FormData) {
  let destination: string | null = null;
  const result = await runAction(formData, createSchema, async (input) => {
    const ctx = await requireOrgAccess(input.organizationId);
    const project = await createProject(ctx, input);
    destination = `/projects/${project.id}/data`;
    return { status: "ok" };
  });
  if (destination) redirect(destination);
  return result;
}

export async function deleteProjectAction(_previous: ActionState, formData: FormData) {
  let deleted = false;
  const result = await runAction(formData, projectSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await deleteProject(ctx);
    deleted = true;
    revalidatePath("/projects");
    return { status: "ok", message: "Project deleted." };
  });
  if (deleted) redirect("/projects");
  return result;
}

const audienceSchema = z.object({ projectId: z.string().min(1), audienceDescription: z.string() });
export async function updateAudienceAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, audienceSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await updateAudienceDescription(ctx, input.audienceDescription);
    revalidatePath(`/projects/${input.projectId}/data`);
    return { status: "ok", message: "SparkToro audience description saved." };
  });
}

const promptStrategyActionSchema = z.intersection(
  z.object({ projectId: z.string().min(1) }),
  promptStrategyInputSchema,
);
export async function updatePromptStrategyAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, promptStrategyActionSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await updatePromptStrategy(ctx, input);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return {
      status: "ok",
      message: "Query Funnel strategy saved. Review the pathway shape before generating.",
    };
  });
}

export async function applyPromptStrategySuggestionsAction(
  _previous: ActionState,
  formData: FormData,
) {
  return runAction(formData, projectSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    const additions = await applyPromptStrategySuggestions(ctx);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return {
      status: "ok",
      message: additions
        ? `Added ${additions} prompt-strategy suggestion${additions === 1 ? "" : "s"} from project research.`
        : "No new structured prompt-strategy signals were found. Add missing items manually or upload category research.",
    };
  });
}

const uploadSchema = sourceInputSchema.extend({ projectId: z.string().min(1) });
export async function uploadProjectFilesAction(_previous: ActionState, formData: FormData) {
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  return runAction(
    formData,
    uploadSchema,
    async (input) => {
      const ctx = await requireProjectAccess(input.projectId);
      const headerList = await headers();
      const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
      const rate = checkRateLimit(`project-upload:${ctx.organizationId}:${ip}`, {
        limit: 30,
        windowMs: 60_000,
      });
      if (!rate.allowed)
        return { status: "error", message: "Too many uploads. Wait a moment and try again." };
      const prepared = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          type: file.type,
          bytes: Buffer.from(await file.arrayBuffer()),
        })),
      );
      const created = await createSourcesFromUploads(ctx, input, prepared);
      revalidatePath(`/projects/${input.projectId}/data`);
      return {
        status: "ok",
        message: `${created.length} source${created.length === 1 ? "" : "s"} queued for parsing, redaction, and signal extraction.`,
      };
    },
    {
      raw: {
        projectId: formData.get("projectId"),
        sourceType: formData.get("sourceType"),
        observedAt: formData.get("observedAt"),
      },
    },
  );
}

const transcriptSchema = sourceInputSchema.extend({
  projectId: z.string().min(1),
  label: z.string().trim().min(2).max(200),
  content: z.string().trim().min(20).max(2_000_000),
});
export async function pasteTranscriptAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, transcriptSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await createSourceFromTranscript(ctx, input);
    revalidatePath(`/projects/${input.projectId}/data`);
    return {
      status: "ok",
      message: "Transcript queued for parsing, redaction, and signal extraction.",
    };
  });
}

export async function generatePersonasAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, projectSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await startPersonaGeneration(ctx);
    revalidatePath(`/projects/${input.projectId}/data`);
    revalidatePath(`/projects/${input.projectId}/personas`);
    return {
      status: "ok",
      message:
        "Persona generation started. The current personas remain available until the replacement is complete.",
    };
  });
}

export async function generatePromptsAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, projectSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await startPromptGeneration(ctx);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return {
      status: "ok",
      message:
        "Query Funnel generation started for every active persona. Existing baselines remain available until the replacement succeeds.",
    };
  });
}

export async function refreshMarketResearchAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, projectSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await startMarketResearch(ctx);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return {
      status: "ok",
      message:
        "Market research refresh started. The approved brief remains active until a draft is approved.",
    };
  });
}

const approveResearchSchema = projectSchema.extend({ briefId: z.string().min(1) });
export async function approveMarketResearchAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, approveResearchSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await approveMarketResearchBrief(ctx, input.briefId);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return { status: "ok", message: "Market research approved and frozen for prompt generation." };
  });
}

const promptReviewSchema = projectSchema.extend({
  promptId: z.string().min(1),
  status: z.enum(["approved", "excluded", "ready"]),
});
export async function reviewPromptAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, promptReviewSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await setPromptReviewStatus(ctx, input.promptId, input.status);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return { status: "ok", message: `Prompt marked ${input.status.replaceAll("_", " ")}.` };
  });
}

export async function approvePromptLibraryAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, projectSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await approveCurrentPromptLibrary(ctx);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return { status: "ok", message: "All quality-passed prompts approved for baseline export." };
  });
}

const promptEditSchema = projectSchema.extend({
  promptId: z.string().min(1),
  promptText: z.string().trim().min(12).max(500),
});
export async function editPromptAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, promptEditSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await editPromptText(ctx, input.promptId, input.promptText);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return {
      status: "ok",
      message: "Draft saved. Regenerate this row to run the quality gate before approval.",
    };
  });
}

const promptRegenerateSchema = projectSchema.extend({ promptId: z.string().min(1) });
export async function regeneratePromptAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, promptRegenerateSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await regenerateSinglePrompt(ctx, input.promptId);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return { status: "ok", message: "This funnel cell was regenerated and rescored." };
  });
}

const retrySchema = projectSchema.extend({ sourceId: z.string().min(1) });
export async function retrySourceAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, retrySchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await retrySource(ctx, input.sourceId);
    revalidatePath(`/projects/${input.projectId}/data`);
    return { status: "ok", message: "Source re-queued." };
  });
}

const editSchema = personaEditSchema.extend({ projectId: z.string().min(1) });
export async function savePersonaAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, editSchema, async (input) => {
    const ctx = await requireProjectAccess(input.projectId);
    await savePersonaVersion(ctx, input);
    revalidatePath(`/projects/${input.projectId}/personas`);
    revalidatePath(`/projects/${input.projectId}/personas/${input.personaId}`);
    revalidatePath(`/projects/${input.projectId}/prompts`);
    return {
      status: "ok",
      message:
        "New persona version saved. Its Query Funnel baseline is refreshing automatically when one already exists.",
    };
  });
}
