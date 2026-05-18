import { createAnthropic } from "@ai-sdk/anthropic"
import { generateObject, jsonSchema } from "ai"
import {
  type CollectionStats,
  enrichListingsWithTraits,
  getCollection,
  getCollectionByContract,
  getCollectionListings,
  getNft,
  getRecentSales,
  type ListingItem,
  type NftDetail,
  type SaleEvent,
} from "./opensea.js"
import { APPRAISAL_SYSTEM_PROMPT } from "./prompts.js"
import {
  type Appraisal,
  AppraisalSchema,
  appraisalJsonSchema,
} from "./schemas.js"

export { type Appraisal, AppraisalSchema } from "./schemas.js"

export interface AppraisalInput {
  chain: string
  contractAddress: string
  tokenId: string
}

interface ScoredComp extends ListingItem {
  score: number
}

// Targets at this rank or better get a wider, stratified comp pool so
// rank-tier listings (typically priced high — their natural sort tail) make
// it past the per-appraisal enrichment cap.
const RARE_RANK_THRESHOLD = 100

export async function fetchAppraisalContext(input: AppraisalInput) {
  const { slug } = await getCollectionByContract(
    input.chain,
    input.contractAddress,
  )

  // Fetch the target NFT first so we can branch on its rarity rank before
  // committing to a listings-fetch strategy. Adds one sequential hop
  // (~150ms) but lets a rare-target appraisal pull a wider, stratified pool.
  const nft = await getNft(input.chain, input.contractAddress, input.tokenId)
  const isRareTarget =
    typeof nft.rarity?.rank === "number" &&
    nft.rarity.rank <= RARE_RANK_THRESHOLD

  const [collection, sales, rawListings] = await Promise.all([
    getCollection(slug),
    getRecentSales(input.chain, input.contractAddress, input.tokenId),
    // For rare targets, fetch up to 500 listings — this covers a 10K
    // collection at 5% list rate. Paginated internally (max 200/page → 3
    // round trips). Common targets stay at 50 (one page).
    getCollectionListings(slug, isRareTarget ? 500 : 50),
  ])

  // OpenSea v2 doesn't return traits with listings, so we fan out per-token
  // to populate them. For rare targets we use stratified mode (cheapest +
  // most-expensive halves) so the comp pool surfaces rank-tier candidates
  // alongside floor anchors. For common targets the cheapest slice is
  // enough — tier-adjacency reasoning isn't load-bearing.
  const listings = await enrichListingsWithTraits(
    input.chain,
    input.contractAddress,
    rawListings,
    { mode: isRareTarget ? "stratified" : "cheap", maxTokens: 30 },
  )

  return { slug, collection, nft, sales, listings, isRareTarget }
}

/**
 * Score listings by trait overlap with the target. Rarer traits (lower
 * frequency in the candidate pool) are weighted higher. Naive but adequate
 * for v1; revisit once we observe real-world appraisals.
 */
export function selectComps(
  target: NftDetail,
  listings: ListingItem[],
  topN = 5,
): ScoredComp[] {
  const traitFreq = new Map<string, number>()
  for (const l of listings) {
    for (const t of l.traits ?? []) {
      const k = `${t.trait_type}=${t.value}`
      traitFreq.set(k, (traitFreq.get(k) ?? 0) + 1)
    }
  }

  const targetTraits = new Set(
    target.traits.map(t => `${t.trait_type}=${t.value}`),
  )

  const scored: ScoredComp[] = listings
    .filter(l => l.tokenId !== target.identifier)
    .map(l => {
      let score = 0
      for (const t of l.traits ?? []) {
        const k = `${t.trait_type}=${t.value}`
        if (!targetTraits.has(k)) continue
        const freq = traitFreq.get(k) ?? 1
        score += 1 / Math.sqrt(freq)
      }
      return { ...l, score }
    })
    .sort((a, b) => b.score - a.score)

  return scored.slice(0, topN)
}

interface LlmContext {
  chain: string
  collection: CollectionStats
  target: NftDetail
  recentSales: SaleEvent[]
  comparables: ScoredComp[]
}

function buildUserContent(ctx: LlmContext): string {
  return JSON.stringify(
    {
      chain: ctx.chain,
      collection: {
        slug: ctx.collection.slug,
        name: ctx.collection.name,
        floorPrice: ctx.collection.floorPrice,
        totalSupply: ctx.collection.totalSupply,
        oneDayVolume: ctx.collection.oneDayVolume,
        totalVolume: ctx.collection.totalVolume,
        numOwners: ctx.collection.numOwners,
      },
      target: {
        tokenId: ctx.target.identifier,
        name: ctx.target.name,
        traits: ctx.target.traits,
        rarity: ctx.target.rarity,
      },
      recentSales: ctx.recentSales,
      comparables: ctx.comparables.map(c => ({
        tokenId: c.tokenId,
        pricePerItem: c.pricePerItem,
        traits: c.traits,
        score: c.score,
      })),
    },
    null,
    2,
  )
}

// Module-level holder for the LLM provider. Set once per Worker fetch
// handler invocation via `setAnthropicConfig({ apiKey, model })` from
// `src/index.ts`. Pass the apiKey explicitly so `@ai-sdk/anthropic`'s
// `loadApiKey` doesn't fall back to `process.env.ANTHROPIC_API_KEY` —
// `process` is undefined on Workers without the nodejs_compat flag.
let anthropicConfig: { apiKey: string; model: string } | undefined

export interface AnthropicConfig {
  apiKey: string
  /** Defaults to claude-sonnet-4-6 if omitted. */
  model?: string
}

export function setAnthropicConfig(opts: AnthropicConfig): void {
  anthropicConfig = {
    apiKey: opts.apiKey,
    model: opts.model ?? "claude-sonnet-4-6",
  }
}

export async function runAppraisal(input: AppraisalInput): Promise<Appraisal> {
  const { collection, nft, sales, listings } =
    await fetchAppraisalContext(input)
  const comparables = selectComps(nft, listings)

  const userContent = buildUserContent({
    chain: input.chain,
    collection,
    target: nft,
    recentSales: sales,
    comparables,
  })

  return await callLlmWithRetry(userContent)
}

async function callLlmWithRetry(userContent: string): Promise<Appraisal> {
  if (!anthropicConfig) {
    throw new Error(
      "Anthropic config not initialized. Call setAnthropicConfig() from your fetch handler.",
    )
  }
  const provider = createAnthropic({ apiKey: anthropicConfig.apiKey })
  const model = provider(anthropicConfig.model)

  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await generateObject({
      model,
      schema: jsonSchema<Appraisal>(appraisalJsonSchema),
      // temperature=0 for the most-deterministic structured output the model
      // can produce. Confidence calibration was variance-prone at default
      // temperature on Haiku 4.5.
      temperature: 0,
      system: APPRAISAL_SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content: userContent,
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
      ],
    })

    const parsed = AppraisalSchema.safeParse(result.object)
    if (parsed.success) return parsed.data
    if (attempt === 1) {
      throw new Error(
        `LLM output failed schema validation after retry: ${parsed.error.message}`,
      )
    }
  }
  throw new Error("unreachable")
}
