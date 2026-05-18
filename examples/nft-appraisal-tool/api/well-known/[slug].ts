import {
  createWellKnownHandler,
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { buildHolderManifest, buildPublicManifest } from "../../src/manifest.js"
import { buildHolderPaywall, buildPublicPaywall } from "../../src/paywall.js"

const rawCreator = process.env.CREATOR_ADDRESS
const rawRecipient = process.env.RECIPIENT_ADDRESS
if (!rawCreator) throw new Error("CREATOR_ADDRESS must be set")
if (!rawRecipient) throw new Error("RECIPIENT_ADDRESS must be set")
const creator = rawCreator as `0x${string}`
const recipient = rawRecipient as `0x${string}`

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://nft-appraisal-tool.vercel.app"

// Both manifests can be built eagerly because they only need pricing — not
// the gate. The holder *gate* needs HOLDER_TOOL_ID (used in api/holder.ts);
// the holder *manifest* doesn't, which lets the holder URL render before
// the holder tool is registered on chain.
const publicPaywall = buildPublicPaywall({ recipient })
const publicManifest = buildPublicManifest({
  creator,
  endpoint: `${baseEndpoint}/api`,
  pricing: publicPaywall.pricing,
})
const publicHandler = toVercelHandler(createWellKnownHandler(publicManifest))

const holderPaywall = buildHolderPaywall({ recipient })
const holderManifest = buildHolderManifest({
  creator,
  endpoint: `${baseEndpoint}/api/holder`,
  pricing: holderPaywall.pricing,
})
const holderHandler = toVercelHandler(createWellKnownHandler(holderManifest))

export default function (req: VercelRequest, res: VercelResponse) {
  // The route catches the full filename (e.g. `nft-appraiser.json`); strip
  // the extension to match the manifest `name`. `req.query` is typed
  // `unknown` on the SDK's VercelRequest (the SDK keeps the surface tiny);
  // Vercel's runtime populates it as a `Record<string, string | string[]>`.
  const query = req.query as Record<string, string | string[] | undefined>
  const rawSlug = query.slug ?? ""
  const slugStr = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug
  const slug = slugStr.replace(/\.json$/, "")

  if (slug === "nft-appraiser") {
    return publicHandler(req, res)
  }
  if (slug === "nft-appraiser-chonks") {
    return holderHandler(req, res)
  }
  res.status(404).send("Not Found")
}
