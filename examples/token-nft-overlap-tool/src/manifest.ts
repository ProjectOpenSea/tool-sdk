import { defineManifest, ERC721OwnerPredicateClient } from "@opensea/tool-sdk"
import { mainnet } from "viem/chains"
import { overlapOutputJsonSchema } from "./schemas.js"

/** Collection gating tool access on Ethereum mainnet. */
export const GATE_COLLECTION =
  "0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4" as const

export interface BuildManifestOptions {
  creator: `0x${string}`
  endpoint: string
}

export function buildManifest(opts: BuildManifestOptions) {
  const predicate = new ERC721OwnerPredicateClient({ chain: mainnet })
  const access = predicate.toManifestAccess(GATE_COLLECTION, {
    label: "Hold an NFT from the gating collection",
  })

  return defineManifest({
    type: "https://eips.ethereum.org/EIPS/eip-8257#tool-manifest-v1",
    name: "token-nft-overlap",
    description:
      "Finds wallets that hold both a specified ERC-20 token and NFTs from a collection. " +
      "Returns the overlap set with holdings data for each wallet. Free for holders.",
    endpoint: opts.endpoint,
    image: "https://token-nft-overlap-tool.vercel.app/token-nft-overlap.png",
    inputs: {
      type: "object",
      properties: {
        chain: {
          type: "string",
          enum: [
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
          ],
          description: "Blockchain (default: ethereum)",
        },
        tokenAddress: {
          type: "string",
          description: "ERC-20 token contract address (0x-prefixed)",
        },
        collectionSlug: {
          type: "string",
          pattern: "^[a-z0-9][a-z0-9-]*$",
          description: "NFT collection slug on OpenSea",
        },
        maxPages: {
          type: "number",
          description:
            "Max pages to fetch per holder list (default 5, max 20). Each page = 100 holders.",
        },
      },
      required: ["tokenAddress", "collectionSlug"],
    },
    outputs: overlapOutputJsonSchema,
    creatorAddress: opts.creator,
    pricing: [],
    access,
    tags: ["opensea", "holders", "overlap", "analytics", "holder-free"],
  })
}
