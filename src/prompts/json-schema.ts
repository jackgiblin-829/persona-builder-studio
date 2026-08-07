import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

/**
 * Converts a Zod schema to the strict JSON Schema the Responses API expects.
 * OpenAI's strict mode requires `additionalProperties: false` everywhere and
 * every property listed in `required`, so we normalise the output rather than
 * maintaining a second hand-written schema that could drift from the Zod one.
 */
export function toStrictJsonSchema(schema: z.ZodTypeAny, name: string): Record<string, unknown> {
  const generated = zodToJsonSchema(schema, {
    name,
    $refStrategy: "none",
    target: "openApi3",
  }) as Record<string, unknown>;

  const definitions = generated.definitions as Record<string, unknown> | undefined;
  const root = (definitions?.[name] as Record<string, unknown>) ?? generated;
  return harden(root);
}

function harden(node: unknown): Record<string, unknown> {
  if (typeof node !== "object" || node === null) return node as Record<string, unknown>;
  const obj = { ...(node as Record<string, unknown>) };

  if (obj.type === "object" && obj.properties && typeof obj.properties === "object") {
    const properties = obj.properties as Record<string, unknown>;
    obj.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, harden(value)]),
    );
    obj.additionalProperties = false;
    obj.required = Object.keys(properties);
  }

  if (obj.type === "array" && obj.items) obj.items = harden(obj.items);
  for (const key of ["anyOf", "oneOf", "allOf"] as const) {
    if (Array.isArray(obj[key])) obj[key] = (obj[key] as unknown[]).map(harden);
  }

  return obj;
}
