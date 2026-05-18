import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { resolveManifest } from "@opensea/tool-sdk"
import { buildHolderManifest, buildPublicManifest } from "../src/manifest.js"
import { buildHolderPaywall, buildPublicPaywall } from "../src/paywall.js"

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

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://nft-appraisal-tool.vercel.app"

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

const holderPaywall = buildHolderPaywall({
  recipient: recipient as `0x${string}`,
})
const holderDef = buildHolderManifest({
  creator: creator as `0x${string}`,
  endpoint: `${baseEndpoint}/api/holder`,
  pricing: holderPaywall.pricing,
})
const holderManifest = resolveManifest(holderDef, process.env)
writeFileSync(
  resolve(process.cwd(), "manifest-holder.json"),
  `${JSON.stringify(holderManifest, null, 2)}\n`,
)
console.log("Wrote manifest-holder.json")
