import type { ZodError } from "zod/v4"
import type { ToolManifest } from "./types.js"
import { ToolManifestSchema } from "./schema.js"

export function defineManifest(manifest: ToolManifest): ToolManifest {
  return manifest
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
