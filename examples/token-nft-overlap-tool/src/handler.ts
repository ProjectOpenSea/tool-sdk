import {
  createToolHandler,
  type Eip3009UsageReporterConfig,
  type GateMiddleware,
  type ManifestDefinition,
  ToolHandlerError,
} from "@opensea/tool-sdk"
import {
  getAccountUsername,
  getCollectionHolders,
  getCollectionMeta,
  getTokenHolders,
  getTokenMeta,
  OpenSeaError,
} from "./opensea.js"
import { InputSchema, OutputSchema, type OverlapOutput } from "./schemas.js"

const MAX_ENRICHED_WALLETS = 25

export interface BuildToolHandlerOptions {
  manifest: ManifestDefinition
  gates: GateMiddleware[]
  /**
   * Optional usage-reporting config. When set, the SDK reports each
   * successful invocation to OpenSea at the end of the lifecycle
   * (fire-and-forget). This tool is free, so reporting rides on the caller's
   * EIP-3009 authorization. Omitted in local/dev where no API key is set.
   */
  usageReporting?: Eip3009UsageReporterConfig
}

export function buildToolHandler(opts: BuildToolHandlerOptions) {
  return createToolHandler({
    manifest: opts.manifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    gates: opts.gates,
    usageReporting: opts.usageReporting,
    handler: async (input): Promise<OverlapOutput> => {
      try {
        const [tokenHolders, nftHolders, collectionMeta, tokenMeta] =
          await Promise.all([
            getTokenHolders(input.chain, input.tokenAddress, input.maxPages),
            getCollectionHolders(input.collectionSlug, input.maxPages),
            getCollectionMeta(input.collectionSlug),
            getTokenMeta(input.chain, input.tokenAddress),
          ])

        const tokenMap = new Map(tokenHolders.map(h => [h.address, h]))
        const nftMap = new Map(nftHolders.map(h => [h.address, h]))

        const overlapAddresses = [...tokenMap.keys()].filter(addr =>
          nftMap.has(addr),
        )

        const topOverlap = overlapAddresses
          .map(addr => {
            const token = tokenMap.get(addr)
            const nft = nftMap.get(addr)
            return {
              address: addr,
              tokenQuantity: token?.quantity ?? 0,
              tokenUsdValue: token?.usdValue ?? 0,
              nftCount: nft?.quantity ?? 0,
              nftOwnershipPct: nft?.ownershipPct ?? 0,
            }
          })
          .sort((a, b) => b.tokenUsdValue - a.tokenUsdValue)
          .slice(0, MAX_ENRICHED_WALLETS)

        const enriched = await Promise.all(
          topOverlap.map(async w => ({
            ...w,
            username: await getAccountUsername(w.address),
          })),
        )

        return {
          token: {
            address: input.tokenAddress,
            name: tokenMeta.name,
            symbol: tokenMeta.symbol,
            totalHoldersFetched: tokenHolders.length,
          },
          collection: {
            slug: input.collectionSlug,
            name: collectionMeta.name,
            floorPriceEth: collectionMeta.floorPriceEth,
            totalHoldersFetched: nftHolders.length,
          },
          overlap: {
            count: overlapAddresses.length,
            wallets: enriched,
          },
          stats: {
            overlapRate:
              tokenHolders.length > 0
                ? overlapAddresses.length / tokenHolders.length
                : 0,
            reverseOverlapRate:
              nftHolders.length > 0
                ? overlapAddresses.length / nftHolders.length
                : 0,
          },
        }
      } catch (err) {
        if (err instanceof OpenSeaError) {
          throw new ToolHandlerError(
            502,
            `OpenSea upstream error: ${err.message}`,
          )
        }
        if (err instanceof Error) {
          throw new ToolHandlerError(
            502,
            `Overlap computation error: ${err.message}`,
          )
        }
        throw err
      }
    },
  })
}
