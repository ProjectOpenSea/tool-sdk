import { z } from "zod/v4"

export const PricingEntrySchema = z.object({
  amount: z.string(),
  asset: z.string(),
  recipient: z.string(),
  protocol: z.string(),
})

export const AccessRequirementLinksSchema = z
  .record(z.string(), z.string())
  .optional()

export const AccessRequirementSchema = z.object({
  kind: z
    .string()
    .regex(/^0x[0-9a-fA-F]{8}$/, "must be a 4-byte hex selector"),
  data: z.string().regex(/^0x[0-9a-fA-F]*$/, "must be hex-encoded"),
  label: z.string().max(256),
  links: AccessRequirementLinksSchema,
})

export const AccessSchema = z.object({
  logic: z.enum(["AND", "OR"]),
  requirements: z.array(AccessRequirementSchema).min(1),
})

export const AttestationSchema = z.object({
  type: z.string().min(1),
  endpoint: z
    .string()
    .url()
    .refine(
      u => u.startsWith("https://"),
      "attestation endpoint must use https",
    )
    .optional(),
  enclaveHash: z
    .string()
    .regex(/^0x([0-9a-fA-F]{2})+$/, "must be hex-encoded")
    .optional(),
  maxAge: z.number().int().positive().optional(),
  transparencyLogURI: z
    .string()
    .url()
    .refine(
      u => u.startsWith("https://"),
      "transparency log URI must use https",
    )
    .optional(),
})

export const ReproducibleBuildSchema = z.object({
  sourceCodeURI: z
    .string()
    .url()
    .refine(
      u => u.startsWith("https://"),
      "source code URI must use https",
    ),
  buildInstructions: z.string().max(1000).optional(),
  buildHash: z
    .string()
    .regex(/^0x([0-9a-fA-F]{2})+$/, "must be hex-encoded")
    .optional(),
})

export const VerifiabilitySchema = z.object({
  tier: z.enum(["self-attested", "hardware-attested", "verifiable"]),
  execution: z.string().min(1),
  description: z.string().min(1).max(500).optional(),
  dataRetention: z
    .enum(["full", "metadata-only", "ephemeral", "none"])
    .optional(),
  sourceVisibility: z
    .enum(["open-source", "audited", "proprietary"])
    .optional(),
  attestation: AttestationSchema.optional(),
  reproducibleBuild: ReproducibleBuildSchema.optional(),
})

export const ToolManifestSchema = z.object({
  type: z
    .string()
    .default(
      "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
    ),
  name: z.string().min(1).max(128),
  description: z.string().min(1).max(500),
  version: z.string().optional(),
  endpoint: z
    .string()
    .url()
    .refine(
      u => u.startsWith("https://"),
      "endpoint must use https",
    ),
  image: z.string().url().optional(),
  tags: z.array(z.string()).optional(),
  inputs: z.record(z.string(), z.unknown()),
  outputs: z.record(z.string(), z.unknown()),
  creatorAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be EVM address"),
  pricing: z.array(PricingEntrySchema).optional(),
  access: AccessSchema.optional(),
  verifiability: VerifiabilitySchema.optional(),
})
