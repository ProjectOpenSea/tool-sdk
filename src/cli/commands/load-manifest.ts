import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { pathToFileURL } from "node:url"
import pc from "picocolors"

function isTypeScriptFile(filePath: string): boolean {
  return /\.(ts|mts)$/.test(filePath)
}

async function loadTypeScriptManifest(fullPath: string): Promise<unknown> {
  const { createJiti } = await import("jiti")
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    fsCache: false,
  })
  const fileUrl = pathToFileURL(fullPath).href
  let mod: Record<string, unknown>
  try {
    mod = (await jiti.import(fileUrl)) as Record<string, unknown>
  } catch (err) {
    console.error(pc.red(`Error: Could not load TypeScript file ${fullPath}`))
    if (err instanceof Error) {
      console.error(pc.yellow(`  ${err.message}`))
    }
    process.exit(1)
  }
  const manifest = mod.manifest ?? mod.default
  if (
    !manifest ||
    (typeof manifest === "object" &&
      Object.keys(manifest as object).length === 0)
  ) {
    console.error(
      pc.red(
        "Error: TypeScript file must export `manifest` or a default export",
      ),
    )
    process.exit(1)
  }
  return manifest
}

function loadJsonManifest(fullPath: string): unknown {
  let raw: string
  try {
    raw = readFileSync(fullPath, "utf-8")
  } catch {
    console.error(pc.red(`Error: Could not read file ${fullPath}`))
    process.exit(1)
  }

  try {
    return JSON.parse(raw)
  } catch {
    console.error(pc.red("Error: Invalid JSON"))
    process.exit(1)
  }
}

export async function loadManifest(filePath: string): Promise<unknown> {
  const fullPath = resolve(process.cwd(), filePath)

  if (isTypeScriptFile(fullPath)) {
    return loadTypeScriptManifest(fullPath)
  }
  return loadJsonManifest(fullPath)
}
