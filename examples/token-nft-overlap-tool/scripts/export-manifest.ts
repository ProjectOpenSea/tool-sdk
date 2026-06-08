import { writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { resolveManifest } from "@opensea/tool-sdk"
import { buildManifest } from "../src/manifest.js"

const creator = process.env.CREATOR_ADDRESS
if (!creator || !/^0x[0-9a-fA-F]{40}$/.test(creator)) {
  console.error(
    "CREATOR_ADDRESS must be set to a valid 0x-prefixed EVM address",
  )
  process.exit(1)
}

const baseEndpoint =
  process.env.TOOL_ENDPOINT ?? "https://token-nft-overlap-tool.vercel.app"

const def = buildManifest({
  creator: creator as `0x${string}`,
  endpoint: `${baseEndpoint}/api`,
})
const manifest = resolveManifest(def, process.env)

writeFileSync(
  resolve(process.cwd(), "manifest.json"),
  `${JSON.stringify(manifest, null, 2)}\n`,
)
console.log("Wrote manifest.json")
