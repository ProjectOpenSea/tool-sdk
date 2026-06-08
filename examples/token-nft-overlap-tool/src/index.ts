import { createWellKnownHandler } from "@opensea/tool-sdk"
import { buildToolHandler } from "./handler.js"
import { buildManifest } from "./manifest.js"
import { setOpenseaApiKey } from "./opensea.js"
import { buildGates } from "./paywall.js"
import { buildUsageReporting } from "./usage.js"

export interface Env {
  OPENSEA_API_KEY: string
  CREATOR_ADDRESS: string
  TOOL_ENDPOINT: string
  HOLDER_TOOL_ID: string
  /** Optional Ethereum RPC URL override for predicate static-calls. */
  ETH_RPC_URL?: string
}

let cachedHandlers: ReturnType<typeof initHandlers> | undefined

function initHandlers(env: Env) {
  if (!/^\d+$/.test(env.HOLDER_TOOL_ID)) {
    throw new Error("HOLDER_TOOL_ID must be a decimal integer string")
  }

  const creator = env.CREATOR_ADDRESS as `0x${string}`
  const endpoint = env.TOOL_ENDPOINT

  const manifest = buildManifest({
    creator,
    endpoint: `${endpoint}/api`,
  })

  const wellKnown = createWellKnownHandler(manifest)
  const handler = buildToolHandler({
    manifest,
    gates: buildGates({
      toolId: BigInt(env.HOLDER_TOOL_ID),
      rpcUrl: env.ETH_RPC_URL,
      operatorAddress: creator,
    }),
    usageReporting: buildUsageReporting({
      apiKey: env.OPENSEA_API_KEY,
      toolOnchainId: Number(env.HOLDER_TOOL_ID),
    }),
  })

  return { wellKnown, handler }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    setOpenseaApiKey(env.OPENSEA_API_KEY)

    if (!cachedHandlers) {
      cachedHandlers = initHandlers(env)
    }

    const url = new URL(request.url)

    if (url.pathname === "/.well-known/ai-tool/token-nft-overlap.json") {
      return cachedHandlers.wellKnown(request)
    }

    if (url.pathname === "/api" || url.pathname === "/") {
      return cachedHandlers.handler(request)
    }

    return new Response("Not Found", { status: 404 })
  },
}
