import type { z } from "zod/v4"
import type {
  AccessRequirementSchema,
  AccessSchema,
  AttestationSchema,
  PricingEntrySchema,
  ReproducibleBuildSchema,
  ToolManifestSchema,
  VerifiabilitySchema,
} from "./schema.js"

export type ToolManifest = z.infer<typeof ToolManifestSchema>
export type PricingEntry = z.infer<typeof PricingEntrySchema>
export type AccessRequirement = z.infer<typeof AccessRequirementSchema>
export type Access = z.infer<typeof AccessSchema>
export type Verifiability = z.infer<typeof VerifiabilitySchema>
export type Attestation = z.infer<typeof AttestationSchema>
export type ReproducibleBuild = z.infer<typeof ReproducibleBuildSchema>
