import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { resolveManifest } from "@opensea/tool-sdk"
import {
  buildPublicManifest,
  buildSubscriberManifest,
} from "../src/manifest.js"
import { buildPublicPaywall } from "../src/paywall.js"

const creator = process.env.CREATOR_ADDRESS
if (!creator || !/^0x[0-9a-fA-F]{40}$/.test(creator)) {
  console.error(
    "CREATOR_ADDRESS must be set to a valid 0x-prefixed EVM address",
  )
  process.exit(1)
}
const recipient = process.env.RECIPIENT_ADDRESS
if (!recipient || !/^0x[0-9a-fA-F]{40}$/.test(recipient)) {
  console.error(
    "RECIPIENT_ADDRESS must be set to a valid 0x-prefixed EVM address",
  )
  process.exit(1)
}
const subscriptionCollection = process.env.SUBSCRIPTION_COLLECTION
if (
  !subscriptionCollection ||
  !/^0x[0-9a-fA-F]{40}$/.test(subscriptionCollection)
) {
  console.error(
    "SUBSCRIPTION_COLLECTION must be set to a valid 0x-prefixed EVM address",
  )
  process.exit(1)
}

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://wallet-personality-tool.vercel.app"
const rawMinTier = process.env.SUBSCRIPTION_MIN_TIER
if (rawMinTier && !/^\d+$/.test(rawMinTier)) {
  console.error("SUBSCRIPTION_MIN_TIER must be a non-negative integer")
  process.exit(1)
}
const minTier = rawMinTier ? Number(rawMinTier) : 0

const publicPaywall = buildPublicPaywall({
  recipient: recipient as `0x${string}`,
})
const publicDef = buildPublicManifest({
  creator: creator as `0x${string}`,
  endpoint: `${baseEndpoint}/api`,
  pricing: publicPaywall.pricing,
})
const publicManifest = resolveManifest(publicDef, process.env)

writeFileSync(
  resolve(process.cwd(), "manifest.json"),
  `${JSON.stringify(publicManifest, null, 2)}\n`,
)
console.log("Wrote manifest.json")

const subscriberDef = buildSubscriberManifest({
  creator: creator as `0x${string}`,
  endpoint: `${baseEndpoint}/api/subscriber`,
  subscriptionCollection: subscriptionCollection as `0x${string}`,
  minTier,
})
const subscriberManifest = resolveManifest(subscriberDef, process.env)
writeFileSync(
  resolve(process.cwd(), "manifest-subscriber.json"),
  `${JSON.stringify(subscriberManifest, null, 2)}\n`,
)
console.log("Wrote manifest-subscriber.json")
