import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { buildToolHandler } from "../src/handler.js"
import { buildManifest } from "../src/manifest.js"
import { setOpenseaApiKey } from "../src/opensea.js"
import { buildGates } from "../src/paywall.js"
import { buildUsageReporting } from "../src/usage.js"

const creator = process.env.CREATOR_ADDRESS as `0x${string}` | undefined
const openseaKey = process.env.OPENSEA_API_KEY
const holderToolId = process.env.HOLDER_TOOL_ID
if (!creator) throw new Error("CREATOR_ADDRESS must be set")
if (!openseaKey) throw new Error("OPENSEA_API_KEY must be set")
if (!holderToolId) throw new Error("HOLDER_TOOL_ID must be set")

setOpenseaApiKey(openseaKey)

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://token-nft-overlap-tool.vercel.app"
const manifest = buildManifest({
  creator,
  endpoint: `${baseEndpoint}/api`,
})
const vercelHandler = toVercelHandler(
  buildToolHandler({
    manifest,
    gates: buildGates({
      toolId: BigInt(holderToolId),
      rpcUrl: process.env.ETH_RPC_URL,
      operatorAddress: creator,
    }),
    usageReporting: buildUsageReporting({
      apiKey: openseaKey,
      toolOnchainId: Number(holderToolId),
    }),
  }),
)

// The LLM + OpenSea holder-overlap computation can run well past Vercel's 10s
// Hobby default; allow up to the Hobby maximum so slow calls don't 502.
export const maxDuration = 60

export default function (req: VercelRequest, res: VercelResponse) {
  return vercelHandler(req, res)
}
