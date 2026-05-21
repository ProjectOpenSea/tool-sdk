import {
  createWellKnownHandler,
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import {
  buildPublicManifest,
  buildSubscriberManifest,
} from "../../src/manifest.js"
import { buildPublicPaywall } from "../../src/paywall.js"

const rawCreator = process.env.CREATOR_ADDRESS
const rawRecipient = process.env.RECIPIENT_ADDRESS
const rawSubscriptionCollection = process.env.SUBSCRIPTION_COLLECTION
if (!rawCreator) throw new Error("CREATOR_ADDRESS must be set")
if (!rawRecipient) throw new Error("RECIPIENT_ADDRESS must be set")
if (!rawSubscriptionCollection)
  throw new Error("SUBSCRIPTION_COLLECTION must be set")
const creator = rawCreator as `0x${string}`
const recipient = rawRecipient as `0x${string}`
const subscriptionCollection = rawSubscriptionCollection as `0x${string}`

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://wallet-personality-tool.vercel.app"

const rawMinTier = process.env.SUBSCRIPTION_MIN_TIER
if (rawMinTier && !/^\d+$/.test(rawMinTier)) {
  throw new Error("SUBSCRIPTION_MIN_TIER must be a non-negative integer")
}
const minTier = rawMinTier ? Number(rawMinTier) : 0

// Both manifests can be built eagerly because they only need creator +
// pricing / collection metadata — not the live toolId. The subscriber
// MANIFEST renders before the tool is registered, which lets the URL be
// reachable for `tool-sdk register --metadata ...`.
const publicPaywall = buildPublicPaywall({ recipient })
const publicManifest = buildPublicManifest({
  creator,
  endpoint: `${baseEndpoint}/api`,
  pricing: publicPaywall.pricing,
})
const publicHandler = toVercelHandler(createWellKnownHandler(publicManifest))

const subscriberManifest = buildSubscriberManifest({
  creator,
  endpoint: `${baseEndpoint}/api/subscriber`,
  subscriptionCollection,
  minTier,
})
const subscriberHandler = toVercelHandler(
  createWellKnownHandler(subscriberManifest),
)

export default function (req: VercelRequest, res: VercelResponse) {
  const query = req.query as Record<string, string | string[] | undefined>
  const rawSlug = query.slug ?? ""
  const slugStr = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug
  const slug = slugStr.replace(/\.json$/, "")

  if (slug === "wallet-personality") {
    return publicHandler(req, res)
  }
  if (slug === "wallet-personality-subscriber") {
    return subscriberHandler(req, res)
  }
  res.status(404).send("Not Found")
}
