import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { setAnthropicConfig } from "../src/appraisal.js"
import { buildToolHandler } from "../src/handler.js"
import { buildPublicManifest } from "../src/manifest.js"
import { setOpenseaApiKey } from "../src/opensea.js"
import { buildPublicPaywall } from "../src/paywall.js"

// Vercel populates process.env before this module loads, so initialization
// happens once at module load. The factory architecture (buildPublicPaywall
// etc.) is the same one the Cloudflare Workers entry uses; only the source
// of env values differs.
const creator = process.env.CREATOR_ADDRESS as `0x${string}` | undefined
const recipient = process.env.RECIPIENT_ADDRESS as `0x${string}` | undefined
const openseaKey = process.env.OPENSEA_API_KEY
const anthropicKey = process.env.ANTHROPIC_API_KEY
if (!creator) throw new Error("CREATOR_ADDRESS must be set")
if (!recipient) throw new Error("RECIPIENT_ADDRESS must be set")
if (!openseaKey) throw new Error("OPENSEA_API_KEY must be set")
if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY must be set")

setOpenseaApiKey(openseaKey)
setAnthropicConfig({
  apiKey: anthropicKey,
  model: process.env.ANTHROPIC_MODEL,
})

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://nft-appraisal-tool.vercel.app"
const paywall = buildPublicPaywall({ recipient })
const manifest = buildPublicManifest({
  creator,
  endpoint: `${baseEndpoint}/api`,
  pricing: paywall.pricing,
})
const vercelHandler = toVercelHandler(
  buildToolHandler({ manifest, gates: [paywall.gate] }),
)

export default function (req: VercelRequest, res: VercelResponse) {
  return vercelHandler(req, res)
}
