import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { buildToolHandler } from "../src/handler.js"
import { buildPublicManifest } from "../src/manifest.js"
import { buildPublicPaywall } from "../src/paywall.js"

const creator = process.env.CREATOR_ADDRESS as `0x${string}` | undefined
const recipient = process.env.RECIPIENT_ADDRESS as `0x${string}` | undefined
if (!creator) throw new Error("CREATOR_ADDRESS must be set")
if (!recipient) throw new Error("RECIPIENT_ADDRESS must be set")
if (!process.env.OPENSEA_API_KEY) throw new Error("OPENSEA_API_KEY must be set")
if (!process.env.ANTHROPIC_API_KEY)
  throw new Error("ANTHROPIC_API_KEY must be set")

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://wallet-personality-tool.vercel.app"
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
