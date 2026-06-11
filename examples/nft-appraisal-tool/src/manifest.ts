import {
  defineManifest,
  type EnvResolver,
  ERC721_KIND,
  type PricingEntry,
} from "@opensea/tool-sdk"
import { appraisalJsonSchema } from "./schemas.js"

/** CHONKs on Base — fixed by product requirement. */
export const CHONK_COLLECTION =
  "0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9" as const

const APPRAISAL_DESCRIPTION =
  "Appraises an NFT given its chain, contract address, and token id. Returns a low/mid/high range with comparable sales and reasoning."

const APPRAISAL_INPUTS = {
  type: "object",
  properties: {
    chain: {
      type: "string",
      description:
        "Chain identifier (e.g. ethereum, base, polygon, arbitrum, optimism)",
    },
    contractAddress: {
      type: "string",
      description: "0x-prefixed 42-character contract address",
    },
    tokenId: {
      type: "string",
      description:
        "Token id as a decimal string (supports tokenIds beyond 2^53)",
    },
  },
  required: ["chain", "contractAddress", "tokenId"],
}

const APPRAISAL_TAGS = ["opensea", "nft", "appraisal"]

export interface BuildManifestOptions {
  /**
   * 0x-prefixed EVM address recorded as the manifest's `creatorAddress`.
   * Per ERC-8257, this MUST match the wallet that registers the tool on
   * the ToolRegistry contract. Anyone cross-checking offchain manifest
   * vs. onchain `creator` will compare these.
   */
  creator: `0x${string}`
  /** Production endpoint URL for this specific tier. */
  endpoint: string
  /** Pricing entries from `buildPublicPaywall(...).pricing` etc. Threaded so
   * the manifest's advertised price and the gate's enforced price are
   * derived from the same source. May be an `EnvResolver` because
   * `defineToolPaywall` produces lazy resolvers in 0.6+. */
  pricing: EnvResolver<PricingEntry[]>
}

/**
 * Public tier manifest — anyone can pay $0.05 USDC. No access predicate.
 */
export function buildPublicManifest(opts: BuildManifestOptions) {
  return defineManifest({
    // The `eip-XXXX` placeholder is preserved deliberately: this string is
    // canonicalized into the manifest hash, and the public tool (toolId=1
    // on Base mainnet) is registered against the hash that includes this
    // exact placeholder. Updating to `eip-8257` would change the hash and
    // require a `tool-sdk update-metadata` tx to keep the registration
    // valid. Bump intentionally if/when you take that step.
    type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
    name: "nft-appraiser",
    description: APPRAISAL_DESCRIPTION,
    endpoint: opts.endpoint,
    inputs: APPRAISAL_INPUTS,
    outputs: appraisalJsonSchema,
    creatorAddress: opts.creator,
    pricing: opts.pricing,
    tags: APPRAISAL_TAGS,
  })
}

/**
 * Holder-tier manifest — discounted to $0.01 USDC for CHONK holders on
 * Base. The `access` field advertises the ERC-721 ownership requirement
 * for offchain discovery; the onchain `accessPredicate` registered on
 * `ToolRegistry` is the authoritative source enforced by `predicateGate`.
 *
 * The ERC-721 access requirement encodes the collection address as a
 * 32-byte left-padded hex string — matching `abi.encode(address)` — which
 * is what `decodeRequirement` and the onchain predicate both expect.
 */
export function buildHolderManifest(opts: BuildManifestOptions) {
  return defineManifest({
    // Same `eip-XXXX` continuity note as in `buildPublicManifest` — the
    // holder tool (toolId=2) is registered against the hash including
    // this placeholder.
    type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
    name: "nft-appraiser-chonks",
    description: `${APPRAISAL_DESCRIPTION} Discounted tier for CHONK holders on Base.`,
    endpoint: opts.endpoint,
    image: "https://nft-appraisal-tool.vercel.app/chonk.png",
    inputs: APPRAISAL_INPUTS,
    outputs: appraisalJsonSchema,
    creatorAddress: opts.creator,
    pricing: opts.pricing,
    access: {
      logic: "AND",
      requirements: [
        {
          kind: ERC721_KIND,
          data: padAddressToBytes32(CHONK_COLLECTION),
          label: "Hold a CHONK on Base",
          links: {
            opensea: `https://opensea.io/assets/base/${CHONK_COLLECTION}`,
          },
        },
      ],
    },
    tags: [...APPRAISAL_TAGS, "chonks", "holder-discount"],
  })
}

function padAddressToBytes32(address: `0x${string}`): `0x${string}` {
  return `0x${address.slice(2).toLowerCase().padStart(64, "0")}`
}
