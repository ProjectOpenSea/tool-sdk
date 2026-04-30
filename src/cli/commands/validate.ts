import { Command } from "commander"
import pc from "picocolors"
import { validateManifest } from "../../lib/manifest/index.js"
import { loadManifest } from "./load-manifest.js"

export const validateCommand = new Command("validate")
  .description("Validate a tool manifest JSON or TypeScript file")
  .argument("[path]", "Path to manifest file", "./src/manifest.ts")
  .action(async (filePath: string) => {
    const data = await loadManifest(filePath)

    const result = validateManifest(data)
    if (result.success) {
      console.log(pc.green("Manifest is valid"))
      console.log(`  Name: ${result.data.name}`)
      console.log(`  Endpoint: ${result.data.endpoint}`)
      console.log(`  Creator: ${result.data.creatorAddress}`)
    } else {
      console.error(pc.red("Manifest validation failed:"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }
  })
