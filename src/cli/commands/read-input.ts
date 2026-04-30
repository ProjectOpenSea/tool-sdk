import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import pc from "picocolors"

export function readInput(raw: string): string {
  if (raw.startsWith("@")) {
    const filePath = resolve(process.cwd(), raw.slice(1))
    try {
      return readFileSync(filePath, "utf-8")
    } catch {
      console.error(pc.red(`Error: Could not read file ${filePath}`))
      process.exit(1)
    }
  }
  return raw
}
