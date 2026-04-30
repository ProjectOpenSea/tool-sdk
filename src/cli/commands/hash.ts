import { Command } from "commander"
import pc from "picocolors"
import { validateManifest } from "../../lib/manifest/index.js"
import { computeManifestHash } from "../../lib/onchain/hash.js"
import { loadManifest } from "./load-manifest.js"

export const hashCommand = new Command("hash")
  .description("Compute the JCS keccak256 hash of a tool manifest")
  .argument("[path]", "Path to manifest file", "./src/manifest.ts")
  .action(async (filePath: string) => {
    const data = await loadManifest(filePath)

    const result = validateManifest(data)
    if (!result.success) {
      console.error(pc.red("Error: Manifest validation failed"))
      process.exit(1)
    }

    const hash = computeManifestHash(result.data)
    console.log(hash)
  })
