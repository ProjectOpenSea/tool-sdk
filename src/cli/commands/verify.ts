import { Command } from "commander"
import pc from "picocolors"
import { validateManifest } from "../../lib/manifest/index.js"
import { computeManifestHash } from "../../lib/onchain/hash.js"

export const verifyCommand = new Command("verify")
  .description("Verify a deployed well-known tool endpoint")
  .argument("<url>", "Well-known manifest URL")
  .action(async (url: string) => {
    const wellKnownPattern =
      /^https:\/\/.+\/\.well-known\/ai-tool\/[a-z0-9]([a-z0-9-]*[a-z0-9])?\.json$/
    if (!wellKnownPattern.test(url)) {
      console.error(pc.red("Error: URL does not match well-known path format"))
      console.error(
        pc.dim("  Expected: https://<origin>/.well-known/ai-tool/<slug>.json"),
      )
      process.exit(1)
    }

    let response: globalThis.Response
    try {
      response = await fetch(url, { redirect: "manual" })
    } catch (err) {
      console.error(pc.red(`Error: Failed to fetch ${url}`))
      console.error(
        pc.dim(`  ${err instanceof Error ? err.message : String(err)}`),
      )
      process.exit(1)
    }

    if (response.status !== 200) {
      console.error(
        pc.red(`Error: HTTP ${response.status} ${response.statusText}`),
      )
      process.exit(1)
    }

    let data: unknown
    try {
      data = await response.json()
    } catch {
      console.error(pc.red("Error: Response is not valid JSON"))
      process.exit(1)
    }

    const result = validateManifest(data)
    if (!result.success) {
      console.error(pc.red("Manifest validation failed:"))
      for (const issue of result.error.issues) {
        console.error(pc.yellow(`  ${issue.path.join(".")}: ${issue.message}`))
      }
      process.exit(1)
    }

    const manifest = result.data

    const manifestOrigin = new URL(url).origin
    const endpointOrigin = new URL(manifest.endpoint).origin
    if (manifestOrigin !== endpointOrigin) {
      console.error(pc.red("Error: Origin mismatch (anti-impersonation check)"))
      console.error(pc.dim(`  Manifest served from: ${manifestOrigin}`))
      console.error(pc.dim(`  Endpoint origin: ${endpointOrigin}`))
      process.exit(1)
    }

    const hash = computeManifestHash(manifest)

    console.log(pc.green("Manifest verified successfully"))
    console.log(`  Name: ${manifest.name}`)
    console.log(`  Endpoint: ${manifest.endpoint}`)
    console.log(`  Creator: ${manifest.creatorAddress}`)
    if (manifest.version) {
      console.log(`  Version: ${manifest.version}`)
    }
    if (manifest.tags?.length) {
      console.log(`  Tags: ${manifest.tags.join(", ")}`)
    }
    console.log(`  Manifest Hash: ${hash}`)
  })
