import {
  createWellKnownHandler,
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "@opensea/tool-sdk"
import { buildManifest } from "../../src/manifest.js"

const rawCreator = process.env.CREATOR_ADDRESS
if (!rawCreator) throw new Error("CREATOR_ADDRESS must be set")
const creator = rawCreator as `0x${string}`

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://token-nft-overlap-tool.vercel.app"

const manifest = buildManifest({
  creator,
  endpoint: `${baseEndpoint}/api`,
})
const handler = toVercelHandler(createWellKnownHandler(manifest))

export default function (req: VercelRequest, res: VercelResponse) {
  const query = req.query as Record<string, string | string[] | undefined>
  const rawSlug = query.slug ?? ""
  const slugStr = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug
  const slug = slugStr.replace(/\.json$/, "")

  if (slug === "token-nft-overlap") {
    return handler(req, res)
  }
  res.status(404).send("Not Found")
}
