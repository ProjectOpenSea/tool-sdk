import type { z } from "zod/v4"
import type { PricingEntrySchema, ToolManifestSchema } from "./schema.js"

export type ToolManifest = z.infer<typeof ToolManifestSchema>
export type PricingEntry = z.infer<typeof PricingEntrySchema>
