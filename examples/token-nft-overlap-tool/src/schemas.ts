import { z } from "zod/v4"

const TokenSummarySchema = z.object({
  address: z.string(),
  name: z.string(),
  symbol: z.string(),
  totalHoldersFetched: z.number(),
})

const CollectionSummarySchema = z.object({
  slug: z.string(),
  name: z.string(),
  floorPriceEth: z.number().nullable(),
  totalHoldersFetched: z.number(),
})

const OverlapWalletSchema = z.object({
  address: z.string(),
  username: z.string().nullable(),
  tokenQuantity: z.number(),
  tokenUsdValue: z.number(),
  nftCount: z.number(),
  nftOwnershipPct: z.number(),
})

const OverlapStatsSchema = z.object({
  overlapRate: z.number(),
  reverseOverlapRate: z.number(),
})

export const InputSchema = z.object({
  chain: z
    .enum([
      "ethereum",
      "base",
      "arbitrum",
      "optimism",
      "polygon",
      "avalanche",
      "blast",
      "zora",
      "sei",
      "ape_chain",
      "solana",
      "abstract",
    ])
    .default("ethereum"),
  tokenAddress: z
    .string()
    .regex(/^0x[0-9a-fA-F]{40}$/, "must be 0x-prefixed 42-char address"),
  collectionSlug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9][a-z0-9-]*$/, "lowercase alphanumeric with hyphens"),
  maxPages: z.number().int().min(1).max(20).default(5),
})

export const OutputSchema = z.object({
  token: TokenSummarySchema,
  collection: CollectionSummarySchema,
  overlap: z.object({
    count: z.number(),
    wallets: z.array(OverlapWalletSchema),
  }),
  stats: OverlapStatsSchema,
})

export type OverlapOutput = z.infer<typeof OutputSchema>

export const overlapOutputJsonSchema = {
  type: "object",
  properties: {
    token: {
      type: "object",
      properties: {
        address: { type: "string" },
        name: { type: "string" },
        symbol: { type: "string" },
        totalHoldersFetched: { type: "number" },
      },
      required: ["address", "name", "symbol", "totalHoldersFetched"],
    },
    collection: {
      type: "object",
      properties: {
        slug: { type: "string" },
        name: { type: "string" },
        floorPriceEth: { type: ["number", "null"] },
        totalHoldersFetched: { type: "number" },
      },
      required: ["slug", "name", "floorPriceEth", "totalHoldersFetched"],
    },
    overlap: {
      type: "object",
      properties: {
        count: { type: "number" },
        wallets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              address: { type: "string" },
              username: { type: ["string", "null"] },
              tokenQuantity: { type: "number" },
              tokenUsdValue: { type: "number" },
              nftCount: { type: "number" },
              nftOwnershipPct: { type: "number" },
            },
            required: [
              "address",
              "username",
              "tokenQuantity",
              "tokenUsdValue",
              "nftCount",
              "nftOwnershipPct",
            ],
          },
        },
      },
      required: ["count", "wallets"],
    },
    stats: {
      type: "object",
      properties: {
        overlapRate: {
          type: "number",
          description: "Fraction of token holders who also hold the NFT",
        },
        reverseOverlapRate: {
          type: "number",
          description: "Fraction of NFT holders who also hold the token",
        },
      },
      required: ["overlapRate", "reverseOverlapRate"],
    },
  },
  required: ["token", "collection", "overlap", "stats"],
} as const
