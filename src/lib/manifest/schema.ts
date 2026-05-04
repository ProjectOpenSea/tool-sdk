import { z } from "zod/v4"

export const PricingEntrySchema = z.object({
  amount: z.string(),
  asset: z.string(),
  recipient: z.string(),
  protocol: z.string(),
})

const MAX_SCHEMA_DEPTH = 32

/**
 * Recursively validates that a value conforms to basic JSON Schema
 * structural invariants (Draft-7).
 */
function validateJsonSchemaStructure(
  schema: Record<string, unknown>,
  ctx: z.core.$RefinementCtx,
  path: string,
  depth = 0,
): void {
  if (depth > MAX_SCHEMA_DEPTH) {
    ctx.addIssue({
      code: "custom",
      message: `${path} exceeds maximum nesting depth of ${MAX_SCHEMA_DEPTH}`,
    })
    return
  }

  if (
    "type" in schema &&
    typeof schema.type !== "string" &&
    !(
      Array.isArray(schema.type) &&
      (schema.type as unknown[]).every(
        item => typeof item === "string",
      )
    )
  ) {
    ctx.addIssue({
      code: "custom",
      message: `${path}.type must be a string or an array of strings`,
    })
  }

  if ("properties" in schema) {
    if (
      typeof schema.properties !== "object" ||
      schema.properties === null ||
      Array.isArray(schema.properties)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${path}.properties must be an object`,
      })
    } else {
      for (const [key, value] of Object.entries(
        schema.properties as Record<string, unknown>,
      )) {
        if (
          typeof value !== "object" ||
          value === null ||
          Array.isArray(value)
        ) {
          ctx.addIssue({
            code: "custom",
            message: `${path}.properties.${key} must be an object`,
          })
        } else {
          validateJsonSchemaStructure(
            value as Record<string, unknown>,
            ctx,
            `${path}.properties.${key}`,
            depth + 1,
          )
        }
      }
    }
  }

  if (
    "required" in schema &&
    (!Array.isArray(schema.required) ||
      !(schema.required as unknown[]).every(
        item => typeof item === "string",
      ))
  ) {
    ctx.addIssue({
      code: "custom",
      message: `${path}.required must be an array of strings`,
    })
  }

  if ("items" in schema) {
    if (
      typeof schema.items !== "object" ||
      schema.items === null ||
      Array.isArray(schema.items)
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${path}.items must be an object`,
      })
    } else {
      validateJsonSchemaStructure(
        schema.items as Record<string, unknown>,
        ctx,
        `${path}.items`,
        depth + 1,
      )
    }
  }
}

function jsonSchemaField(fieldName: string) {
  return z
    .record(z.string(), z.unknown())
    .superRefine((val, ctx) => {
      validateJsonSchemaStructure(val, ctx, fieldName)
    })
}

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
  inputs: jsonSchemaField("inputs"),
  outputs: jsonSchemaField("outputs"),
  creatorAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be EVM address"),
  pricing: z.array(PricingEntrySchema).optional(),
  access: AccessSchema.optional(),
  verifiability: VerifiabilitySchema.optional(),
})
