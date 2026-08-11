import "server-only";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { personas, personaVersions } from "@/db/schema";
import type { ProjectContext } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";

export async function listActivePersonas(ctx: ProjectContext) {
  return db
    .select({ persona: personas, version: personaVersions })
    .from(personas)
    .innerJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
    .where(
      and(
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.projectId, ctx.projectId),
        isNull(personas.archivedAt),
      ),
    )
    .orderBy(asc(personas.name));
}

export async function getPersonaDetail(ctx: ProjectContext, personaId: string) {
  const [current] = await db
    .select({ persona: personas, version: personaVersions })
    .from(personas)
    .innerJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
    .where(
      and(
        eq(personas.id, personaId),
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.projectId, ctx.projectId),
      ),
    )
    .limit(1);
  if (!current) throw new NotFoundError("Persona");
  const versions = await db
    .select()
    .from(personaVersions)
    .where(eq(personaVersions.personaId, personaId))
    .orderBy(desc(personaVersions.version));
  return { ...current, versions };
}
