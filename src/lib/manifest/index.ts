import type { ZodError } from "zod/v4"
import type { PricingEntry, ToolManifest } from "./types.js"
import { ToolManifestSchema } from "./schema.js"

export type EnvResolver<T> = T | ((env: Record<string, string | undefined>) => T)

export interface ManifestDefinition
  extends Omit<ToolManifest, "endpoint" | "creatorAddress" | "pricing"> {
  endpoint: EnvResolver<string>
  creatorAddress: EnvResolver<string>
  pricing?: EnvResolver<PricingEntry[]>
}

export function defineManifest(definition: ManifestDefinition): ManifestDefinition {
  return definition
}

export function resolveManifest(
  definition: ManifestDefinition,
  env: Record<string, string | undefined>,
): ToolManifest {
  const resolved = {
    ...definition,
    endpoint: resolveField(definition.endpoint, env, "endpoint"),
    creatorAddress: resolveField(definition.creatorAddress, env, "creatorAddress"),
    pricing: definition.pricing !== undefined
      ? resolveField(definition.pricing, env, "pricing")
      : undefined,
  }
  const result = ToolManifestSchema.safeParse(resolved)
  if (!result.success) {
    throw new Error(
      `[tool-sdk] Resolved manifest is invalid: ${result.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    )
  }
  return result.data
}

function resolveField<T>(
  value: EnvResolver<T>,
  env: Record<string, string | undefined>,
  fieldName: string,
): T {
  if (typeof value === "function") {
    const resolved = (value as (env: Record<string, string | undefined>) => T)(env)
    if (resolved === undefined || resolved === null) {
      throw new Error(
        `[tool-sdk] Resolver for "${fieldName}" returned ${String(resolved)}. ` +
          "Check that the required environment variable is set.",
      )
    }
    return resolved
  }
  return value
}

type ValidateResult =
  | { success: true; data: ToolManifest }
  | { success: false; error: ZodError }

export function validateManifest(data: unknown): ValidateResult {
  const result = ToolManifestSchema.safeParse(data)
  if (result.success) {
    return { success: true, data: result.data }
  }
  return { success: false, error: result.error }
}
