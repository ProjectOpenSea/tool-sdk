import { z } from "zod/v4"

/**
 * Single source of truth for the appraisal output shape.
 *
 * Two parallel definitions:
 * - `appraisalJsonSchema`: hand-written JSON Schema, fed to the manifest's
 *   `outputs` field AND to the AI SDK's `jsonSchema()` helper for structured
 *   LLM output. ai@4's zod adapter targets zod@3 and silently produces
 *   malformed Anthropic tool definitions for zod@4 schemas, so the JSON
 *   Schema is the canonical version.
 * - `AppraisalSchema`: zod@4 schema, used for runtime validation of the LLM
 *   response and to derive the static `Appraisal` type.
 *
 * Keep both in sync. The runtime parse + retry-once loop in `appraisal.ts`
 * catches any drift before it reaches a caller.
 */

const PriceSchema = z.object({
  amount: z.string(),
  currency: z.string(),
  usd: z.number(),
})

export const AppraisalSchema = z.object({
  low: PriceSchema,
  mid: PriceSchema,
  high: PriceSchema,
  confidence: z.enum(["low", "medium", "high"]),
  reasoning: z.string(),
  recentSales: z.array(
    z.object({
      tokenId: z.string(),
      salePrice: PriceSchema,
      soldAt: z.string(),
      relevanceNote: z.string(),
    }),
  ),
  comparableListings: z.array(
    z.object({
      tokenId: z.string(),
      listingPrice: PriceSchema,
      relevanceNote: z.string(),
    }),
  ),
})

export type Appraisal = z.infer<typeof AppraisalSchema>

const priceJsonSchema = {
  type: "object",
  properties: {
    amount: { type: "string" },
    currency: { type: "string" },
    usd: { type: "number" },
  },
  required: ["amount", "currency", "usd"],
  additionalProperties: false,
} as const

export const appraisalJsonSchema = {
  type: "object",
  properties: {
    low: priceJsonSchema,
    mid: priceJsonSchema,
    high: priceJsonSchema,
    confidence: { type: "string", enum: ["low", "medium", "high"] },
    reasoning: { type: "string" },
    recentSales: {
      type: "array",
      description:
        "Past onchain sales of this exact token, or sales of very close comparables when the exact token has none. Each entry MUST have a real ISO 8601 soldAt — do not invent timestamps.",
      items: {
        type: "object",
        properties: {
          tokenId: { type: "string" },
          salePrice: priceJsonSchema,
          soldAt: {
            type: "string",
            description: "ISO 8601 timestamp of the sale",
          },
          relevanceNote: { type: "string" },
        },
        required: ["tokenId", "salePrice", "soldAt", "relevanceNote"],
        additionalProperties: false,
      },
    },
    comparableListings: {
      type: "array",
      description:
        "Currently active listings of OTHER tokens in the same collection that share rare traits with the target. No timestamps because these are live offers, not historical sales.",
      items: {
        type: "object",
        properties: {
          tokenId: { type: "string" },
          listingPrice: priceJsonSchema,
          relevanceNote: { type: "string" },
        },
        required: ["tokenId", "listingPrice", "relevanceNote"],
        additionalProperties: false,
      },
    },
  },
  required: [
    "low",
    "mid",
    "high",
    "confidence",
    "reasoning",
    "recentSales",
    "comparableListings",
  ],
  additionalProperties: false,
} as const
