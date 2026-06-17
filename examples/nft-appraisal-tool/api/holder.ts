import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { setAnthropicConfig } from "../src/appraisal.js"
import { buildToolHandler } from "../src/handler.js"
import { buildHolderManifest } from "../src/manifest.js"
import { setOpenseaApiKey } from "../src/opensea.js"
import { buildHolderGates, buildHolderPaywall } from "../src/paywall.js"
import { buildUsageReporting } from "../src/usage.js"

const creator = process.env.CREATOR_ADDRESS as `0x${string}` | undefined
const recipient = process.env.RECIPIENT_ADDRESS as `0x${string}` | undefined
const openseaKey = process.env.OPENSEA_API_KEY
const anthropicKey = process.env.ANTHROPIC_API_KEY
const holderToolId = process.env.HOLDER_TOOL_ID
if (!creator) throw new Error("CREATOR_ADDRESS must be set")
if (!recipient) throw new Error("RECIPIENT_ADDRESS must be set")
if (!openseaKey) throw new Error("OPENSEA_API_KEY must be set")
if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY must be set")
if (!holderToolId) throw new Error("HOLDER_TOOL_ID must be set")
if (!/^\d+$/.test(holderToolId))
  throw new Error("HOLDER_TOOL_ID must be a decimal integer string")

setOpenseaApiKey(openseaKey)
setAnthropicConfig({
  apiKey: anthropicKey,
  model: process.env.ANTHROPIC_MODEL,
})

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://nft-appraisal-tool.vercel.app"
const paywall = buildHolderPaywall({ recipient })
const gates = buildHolderGates({
  toolId: BigInt(holderToolId),
  rpcUrl: process.env.BASE_RPC_URL,
  recipient,
})
const manifest = buildHolderManifest({
  creator,
  endpoint: `${baseEndpoint}/api/holder`,
  pricing: paywall.pricing,
})
const vercelHandler = toVercelHandler(
  buildToolHandler({
    manifest,
    gates,
    // Holder tier is tool id 2 on the Base ToolRegistry (HOLDER_TOOL_ID).
    usageReporting: buildUsageReporting({
      apiKey: openseaKey,
      toolOnchainId: Number(holderToolId),
    }),
  }),
)

// The LLM appraisal + OpenSea data fetch can run well past Vercel's 10s Hobby
// default; allow up to the Hobby maximum so slow calls don't 502.
export const maxDuration = 60

export default function (req: VercelRequest, res: VercelResponse) {
  return vercelHandler(req, res)
}
