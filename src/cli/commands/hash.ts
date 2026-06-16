import { Command } from "commander"
import pc from "picocolors"
import { validateManifest } from "../../lib/manifest/index.js"
import { computeManifestHash } from "../../lib/onchain/hash.js"
import { loadManifest } from "./load-manifest.js"
import { warnBareExtensionKeys } from "./warn-bare-extensions.js"

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

    warnBareExtensionKeys(data)

    // Hash the manifest as served (ERC-8257 §2): the full document, not the
    // schema-stripped copy.
    const hash = computeManifestHash(data as object)
    console.log(hash)
  })
