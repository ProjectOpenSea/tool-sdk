import { z } from "zod/v4"

/**
 * Single source of truth for all I/O shapes.
 *
 * `PersonalitySchema` (zod v4) validates the LLM response at runtime.
 * `personalityJsonSchema` is the parallel hand-written JSON Schema fed to
 * the manifest's `outputs` field and to the AI SDK's `jsonSchema()` helper
 * for structured LLM output. ai@4's zod adapter targets zod@3 and produces
 * malformed Anthropic tool definitions for zod@4 schemas, so the JSON
 * Schema is the canonical version. Drift between the two is caught by the
 * parse + retry loop in `personality.ts`.
 */

export const InputSchema = z.object({
  targetAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x-prefixed 42-char address")
    .optional(),
})

const formativeLoreItem = z.object({
  event: z.string().min(1).max(300),
  impact: z.string().min(1).max(300),
})

export const PersonalitySchema = z.object({
  archetype: z.string().min(1).max(200),
  vibe: z.string().min(1).max(800),
  voice: z.string().min(1).max(600),
  taste: z.string().min(1).max(800),
  tradingPhilosophy: z.string().min(1).max(800),
  signatureBehaviors: z.array(z.string().min(1).max(200)).min(1).max(5),
  signaturePhrases: z.array(z.string().min(1).max(120)).min(0).max(5),
  formativeLore: z.array(formativeLoreItem).min(0).max(3),
  currentChapter: z.string().min(1).max(1000),
  doList: z.array(z.string().min(1).max(200)).min(1).max(5),
  dontList: z.array(z.string().min(1).max(200)).min(1).max(5),
})

export type Personality = z.infer<typeof PersonalitySchema>

export const ResponseSchema = PersonalitySchema.extend({
  targetAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  generatedAt: z.string(),
  markdown: z.string(),
})

export type ResponsePayload = z.infer<typeof ResponseSchema>

export const WalletDigestSchema = z.object({
  address: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  ens: z.string().nullable(),
  profileName: z.string().nullable(),

  snapshot: z.object({
    distinctCollectionCount: z.number().int().min(0),
    topCollections: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        count: z.number().int().min(1),
        floorEth: z.number().nullable(),
        totalSupply: z.number().nullable(),
        holderCount: z.number().nullable(),
        description: z.string().nullable(),
        chain: z.string().nullable(),
        createdAtYear: z.number().int().nullable(),
      }),
    ),
    tokenSplit: z.object({
      ethEthEquivalent: z.number(),
      stablesUsd: z.number(),
      otherUsd: z.number(),
    }),
  }),

  activity90d: z.object({
    tradeCount: z.number().int().min(0),
    buySellRatio: z.number().min(0),
    mintParticipation: z.number().int().min(0),
    listingCadence: z.object({
      activeListings: z.number().int().min(0),
      listingsPlaced: z.number().int().min(0),
      listingsCancelled: z.number().int().min(0),
    }),
    distinctCollectionsTraded: z.number().int().min(0),
    timeOfDayHistogram: z.array(z.number().int().min(0)).length(24),
    medianHoldOnFlippedTokensDays: z.number().nullable(),
  }),

  formative: z.object({
    biggestWin: z
      .object({
        collectionSlug: z.string(),
        tokenId: z.string(),
        entryEth: z.number(),
        exitEth: z.number(),
        profitEth: z.number(),
        holdDays: z.number().int().min(0),
        exitDate: z.string(),
      })
      .nullable(),
    biggestLoss: z
      .object({
        collectionSlug: z.string(),
        tokenId: z.string(),
        entryEth: z.number(),
        exitEth: z.number(),
        lossEth: z.number(),
        holdDays: z.number().int().min(0),
        exitDate: z.string(),
      })
      .nullable(),
    longestHold: z
      .object({
        collectionSlug: z.string(),
        tokenId: z.string(),
        acquiredAt: z.string(),
        holdDaysSoFar: z.number().int().min(0),
      })
      .nullable(),
  }),
})

export type WalletDigest = z.infer<typeof WalletDigestSchema>

const stringArray = {
  type: "array",
  items: { type: "string" },
} as const

export const personalityJsonSchema = {
  type: "object",
  properties: {
    archetype: {
      type: "string",
      description: "One-sentence summary of who this wallet is.",
    },
    vibe: { type: "string", description: "Atmosphere / mood paragraph." },
    voice: {
      type: "string",
      description:
        "How this wallet speaks — sentence shape, register, cadence.",
    },
    taste: {
      type: "string",
      description: "What it loves and what it's cool on.",
    },
    tradingPhilosophy: {
      type: "string",
      description: "How it buys, holds, and lists. Behavior, not advice.",
    },
    signatureBehaviors: {
      ...stringArray,
      minItems: 1,
      maxItems: 5,
      description:
        "Array of short behavioral patterns observable from the digest data. Each array element is one observation; produce 3 to 5 elements.",
    },
    signaturePhrases: {
      ...stringArray,
      minItems: 0,
      maxItems: 5,
      description:
        "Array of short phrases the wallet would plausibly say. Each array element is one phrase; produce 0 to 5 elements.",
    },
    formativeLore: {
      type: "array",
      minItems: 0,
      maxItems: 3,
      description:
        "Array of formative trade events. Each array element is an object with `event` and `impact` strings; produce 0 to 3 elements. Every entry MUST reference real data in digest.formative — do not invent.",
      items: {
        type: "object",
        properties: {
          event: { type: "string" },
          impact: { type: "string" },
        },
        required: ["event", "impact"],
        additionalProperties: false,
      },
    },
    currentChapter: {
      type: "string",
      description: "What the last 90 days have looked like.",
    },
    doList: {
      ...stringArray,
      minItems: 1,
      maxItems: 5,
      description:
        "Array of 'do' rules for downstream agents speaking as this wallet. Each array element is one rule; produce 1 to 5 elements.",
    },
    dontList: {
      ...stringArray,
      minItems: 1,
      maxItems: 5,
      description:
        "Array of 'don't' rules for downstream agents speaking as this wallet. Each array element is one rule; produce 1 to 5 elements.",
    },
  },
  required: [
    "archetype",
    "vibe",
    "voice",
    "taste",
    "tradingPhilosophy",
    "signatureBehaviors",
    "signaturePhrases",
    "formativeLore",
    "currentChapter",
    "doList",
    "dontList",
  ],
  additionalProperties: false,
} as const

export const manifestOutputsJsonSchema = {
  type: "object",
  properties: {
    targetAddress: { type: "string" },
    generatedAt: { type: "string" },
    archetype: { type: "string" },
    vibe: { type: "string" },
    voice: { type: "string" },
    taste: { type: "string" },
    tradingPhilosophy: { type: "string" },
    signatureBehaviors: stringArray,
    signaturePhrases: stringArray,
    formativeLore: {
      type: "array",
      items: {
        type: "object",
        properties: {
          event: { type: "string" },
          impact: { type: "string" },
        },
        required: ["event", "impact"],
        additionalProperties: false,
      },
    },
    currentChapter: { type: "string" },
    doList: stringArray,
    dontList: stringArray,
    markdown: { type: "string" },
  },
  required: [
    "targetAddress",
    "generatedAt",
    "archetype",
    "vibe",
    "voice",
    "taste",
    "tradingPhilosophy",
    "signatureBehaviors",
    "signaturePhrases",
    "formativeLore",
    "currentChapter",
    "doList",
    "dontList",
    "markdown",
  ],
  additionalProperties: false,
} as const
