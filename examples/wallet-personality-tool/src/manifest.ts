import {
  defineManifest,
  type EnvResolver,
  type PricingEntry,
  SUBSCRIPTION_KIND,
} from "@opensea/tool-sdk"
import { encodeAbiParameters } from "viem"
import { manifestOutputsJsonSchema } from "./schemas.js"

const DESCRIPTION =
  "Generates a markdown personality file from a wallet's onchain history. The file is structured for use as an LLM system prompt and also reads as a vibe report to humans."

const INPUTS = {
  type: "object",
  properties: {
    targetAddress: {
      type: "string",
      description:
        "Optional 0x-prefixed 42-character EVM address. If omitted, defaults to the SIWE-recovered caller address.",
    },
  },
  required: [],
}

const TAGS = ["opensea", "wallet", "personality", "base"]

export interface BuildPublicManifestOptions {
  /**
   * 0x-prefixed EVM address recorded as the manifest's `creatorAddress`.
   * Per ERC-8257, this MUST equal the wallet that registers the tool on
   * the `ToolRegistry`.
   */
  creator: `0x${string}`
  /** Production endpoint URL for the public route. */
  endpoint: string
  /** Pricing entries from `buildPublicPaywall(...).pricing`. */
  pricing: EnvResolver<PricingEntry[]>
}

/**
 * Public tier — anyone can pay $0.05 USDC. No access predicate.
 */
export function buildPublicManifest(opts: BuildPublicManifestOptions) {
  return defineManifest({
    type: "https://eips.ethereum.org/EIPS/eip-8257#tool-manifest-v1",
    name: "wallet-personality",
    description: DESCRIPTION,
    endpoint: opts.endpoint,
    inputs: INPUTS,
    outputs: manifestOutputsJsonSchema,
    creatorAddress: opts.creator,
    pricing: opts.pricing,
    tags: [...TAGS, "paywalled"],
  })
}

export interface BuildSubscriberManifestOptions {
  /** Same constraint as `buildPublicManifest.creator`. */
  creator: `0x${string}`
  /** Production endpoint URL for the subscriber route. */
  endpoint: string
  /** Subscription NFT contract on Base. Holders pass the gate. */
  subscriptionCollection: `0x${string}`
  /**
   * Minimum tier required to pass the SubscriptionPredicate gate.
   * `0` means "any active subscription" — the SubscriptionPredicate
   * interprets `minTier === 0` as "no tier requirement, only validity".
   */
  minTier?: number
}

/**
 * Subscriber tier — free for holders of an active subscription NFT.
 * The `access` field advertises the requirement for offchain discovery;
 * the authoritative check is the onchain `accessPredicate` enforced by
 * `predicateGate` on the request path.
 */
export function buildSubscriberManifest(opts: BuildSubscriberManifestOptions) {
  const minTier = opts.minTier ?? 0
  const requirementData = encodeAbiParameters(
    [{ type: "address" }, { type: "uint8" }],
    [opts.subscriptionCollection, minTier],
  )
  return defineManifest({
    type: "https://eips.ethereum.org/EIPS/eip-8257#tool-manifest-v1",
    name: "wallet-personality-subscriber",
    description: `${DESCRIPTION} Free for active subscribers.`,
    endpoint: opts.endpoint,
    inputs: INPUTS,
    outputs: manifestOutputsJsonSchema,
    creatorAddress: opts.creator,
    pricing: [],
    access: {
      logic: "AND",
      requirements: [
        {
          kind: SUBSCRIPTION_KIND,
          data: requirementData,
          label:
            minTier > 0
              ? `Active subscription (tier ${minTier}+)`
              : "Active subscription",
          links: {
            opensea: `https://opensea.io/assets/base/${opts.subscriptionCollection}`,
          },
        },
      ],
    },
    tags: [...TAGS, "subscriber-free"],
  })
}
