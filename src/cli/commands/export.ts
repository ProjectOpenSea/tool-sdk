import { Command } from "commander"
import pc from "picocolors"
import { validateManifest } from "../../lib/manifest/index.js"
import { loadManifest } from "./load-manifest.js"

export const exportCommand = new Command("export")
  .description("Load a TypeScript manifest and output it as JSON")
  .argument("[path]", "Path to manifest file", "./src/manifest.ts")
  .action(async (filePath: string) => {
    const data = await loadManifest(filePath)

    const result = validateManifest(data)
    if (!result.success) {
      console.error(pc.red("Manifest validation failed:"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }

    console.log(JSON.stringify(result.data, null, 2))
  })
