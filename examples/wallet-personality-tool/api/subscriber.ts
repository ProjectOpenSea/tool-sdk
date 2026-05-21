import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { buildToolHandler } from "../src/handler.js"
import { buildSubscriberManifest } from "../src/manifest.js"
import { buildSubscriberGates } from "../src/paywall.js"

const creator = process.env.CREATOR_ADDRESS as `0x${string}` | undefined
const subscriptionCollection = process.env.SUBSCRIPTION_COLLECTION as
  | `0x${string}`
  | undefined
const subscriberToolId = process.env.SUBSCRIBER_TOOL_ID
if (!creator) throw new Error("CREATOR_ADDRESS must be set")
if (!subscriptionCollection)
  throw new Error("SUBSCRIPTION_COLLECTION must be set")
if (!subscriberToolId) throw new Error("SUBSCRIBER_TOOL_ID must be set")
if (!/^\d+$/.test(subscriberToolId))
  throw new Error("SUBSCRIBER_TOOL_ID must be a decimal integer string")
if (!process.env.OPENSEA_API_KEY) throw new Error("OPENSEA_API_KEY must be set")
if (!process.env.ANTHROPIC_API_KEY)
  throw new Error("ANTHROPIC_API_KEY must be set")

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://wallet-personality-tool.vercel.app"
const rawMinTier = process.env.SUBSCRIPTION_MIN_TIER
if (rawMinTier && !/^\d+$/.test(rawMinTier)) {
  throw new Error("SUBSCRIPTION_MIN_TIER must be a non-negative integer")
}
const minTier = rawMinTier ? Number(rawMinTier) : 0
const gates = buildSubscriberGates({
  toolId: BigInt(subscriberToolId),
  rpcUrl: process.env.BASE_RPC_URL,
})
const manifest = buildSubscriberManifest({
  creator,
  endpoint: `${baseEndpoint}/api/subscriber`,
  subscriptionCollection,
  minTier,
})
const vercelHandler = toVercelHandler(buildToolHandler({ manifest, gates }))

export default function (req: VercelRequest, res: VercelResponse) {
  return vercelHandler(req, res)
}
