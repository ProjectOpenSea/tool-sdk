import { createWellKnownHandler } from "@opensea/tool-sdk"
import { setAnthropicConfig } from "./appraisal.js"
import { buildToolHandler } from "./handler.js"
import { buildHolderManifest, buildPublicManifest } from "./manifest.js"
import { setOpenseaApiKey } from "./opensea.js"
import {
  buildHolderGates,
  buildHolderPaywall,
  buildPublicPaywall,
} from "./paywall.js"
import { buildUsageReporting } from "./usage.js"

export interface Env {
  OPENSEA_API_KEY: string
  ANTHROPIC_API_KEY: string
  /**
   * 0x-prefixed address recorded as the manifest's creatorAddress.
   * Per ERC-8257, MUST equal the wallet that registers the tool on chain.
   */
  CREATOR_ADDRESS: string
  /** 0x-prefixed payout address for x402 USDC. */
  RECIPIENT_ADDRESS: string
  TOOL_ENDPOINT: string
  /**
   * On-chain ToolRegistry tool ID for the holder tier (decimal string).
   * Required because `predicateGate` staticcalls
   * `tryHasAccess(toolId, caller)` against the registry. Set after
   * registering the holder tool with the ERC-721 owner predicate pointed
   * at the CHONK collection on Base.
   */
  HOLDER_TOOL_ID: string
  /** Optional Base RPC URL override for predicate static-calls. */
  BASE_RPC_URL?: string
  ANTHROPIC_MODEL?: string
}

// Lazy-init cache so handlers are built once per isolate, not per request.
let cachedHandlers: ReturnType<typeof initHandlers> | undefined

function initHandlers(env: Env) {
  const creator = env.CREATOR_ADDRESS as `0x${string}`
  const recipient = env.RECIPIENT_ADDRESS as `0x${string}`
  const endpoint = env.TOOL_ENDPOINT

  if (!/^\d+$/.test(env.HOLDER_TOOL_ID) && env.HOLDER_TOOL_ID !== undefined) {
    throw new Error("HOLDER_TOOL_ID must be a decimal integer string")
  }

  const publicPaywall = buildPublicPaywall({ recipient })
  const publicManifest = buildPublicManifest({
    creator,
    endpoint: `${endpoint}/api`,
    pricing: publicPaywall.pricing,
  })

  const holderPaywall = buildHolderPaywall({ recipient })
  const holderManifest = buildHolderManifest({
    creator,
    endpoint: `${endpoint}/api/holder`,
    pricing: holderPaywall.pricing,
  })

  const publicWellKnown = createWellKnownHandler(publicManifest)
  const holderWellKnown = createWellKnownHandler(holderManifest)
  const publicHandler = buildToolHandler({
    manifest: publicManifest,
    gates: [publicPaywall.gate],
    // Public tier is tool id 1 on the Base ToolRegistry (see README).
    usageReporting: buildUsageReporting({
      apiKey: env.OPENSEA_API_KEY,
      toolOnchainId: 1,
    }),
  })
  const holderHandler = env.HOLDER_TOOL_ID
    ? buildToolHandler({
        manifest: holderManifest,
        gates: buildHolderGates(holderPaywall, {
          toolId: BigInt(env.HOLDER_TOOL_ID),
          rpcUrl: env.BASE_RPC_URL,
        }),
        usageReporting: buildUsageReporting({
          apiKey: env.OPENSEA_API_KEY,
          toolOnchainId: Number(env.HOLDER_TOOL_ID),
        }),
      })
    : undefined

  return {
    publicWellKnown,
    holderWellKnown,
    publicHandler,
    holderHandler,
  }
}

/**
 * Cloudflare Workers entry. Routes:
 * - GET  /.well-known/ai-tool/nft-appraiser.json         → public manifest
 * - GET  /.well-known/ai-tool/nft-appraiser-chonks.json  → holder manifest
 * - POST /api          → public tool handler        ($0.05 USDC)
 * - POST /api/holder   → holder tool handler        ($0.01 USDC + CHONK)
 * - everything else                                       → 404
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    setOpenseaApiKey(env.OPENSEA_API_KEY)
    setAnthropicConfig({
      apiKey: env.ANTHROPIC_API_KEY,
      model: env.ANTHROPIC_MODEL,
    })

    if (!cachedHandlers) {
      cachedHandlers = initHandlers(env)
    }

    const url = new URL(request.url)

    if (url.pathname === "/.well-known/ai-tool/nft-appraiser.json") {
      return cachedHandlers.publicWellKnown(request)
    }

    if (url.pathname === "/.well-known/ai-tool/nft-appraiser-chonks.json") {
      return cachedHandlers.holderWellKnown(request)
    }

    if (url.pathname === "/api/holder") {
      if (!cachedHandlers.holderHandler) {
        return new Response("HOLDER_TOOL_ID not configured", { status: 503 })
      }
      return cachedHandlers.holderHandler(request)
    }

    if (url.pathname === "/api" || url.pathname === "/") {
      return cachedHandlers.publicHandler(request)
    }

    return new Response("Not Found", { status: 404 })
  },
}
