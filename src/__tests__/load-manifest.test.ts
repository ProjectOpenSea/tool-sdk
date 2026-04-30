import { mkdirSync, rmSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest"
import { loadManifest } from "../cli/commands/load-manifest.js"

const fixturesDir = join(import.meta.dirname, "__fixtures__")

const validManifestJson = JSON.stringify({
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: { type: "object", properties: {} },
  outputs: { type: "object", properties: {} },
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
})

const validManifestTs = `
export const manifest = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool-ts",
  description: "A TypeScript test tool",
  endpoint: "https://test.example.com",
  inputs: { type: "object", properties: {} },
  outputs: { type: "object", properties: {} },
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
}
`

const defaultExportManifestTs = `
export default {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool-default",
  description: "A TypeScript test tool with default export",
  endpoint: "https://test.example.com",
  inputs: { type: "object", properties: {} },
  outputs: { type: "object", properties: {} },
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
}
`

const noExportManifestTs = `
const localOnly = { name: "not-exported" }
`

const invalidJsonContent = "{ not valid json }"

class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

beforeAll(() => {
  mkdirSync(fixturesDir, { recursive: true })
  writeFileSync(join(fixturesDir, "valid.json"), validManifestJson)
  writeFileSync(join(fixturesDir, "valid.ts"), validManifestTs)
  writeFileSync(join(fixturesDir, "default-export.ts"), defaultExportManifestTs)
  writeFileSync(join(fixturesDir, "no-export.ts"), noExportManifestTs)
  writeFileSync(join(fixturesDir, "invalid.json"), invalidJsonContent)
})

afterAll(() => {
  rmSync(fixturesDir, { recursive: true, force: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("loadManifest", () => {
  it("should load a valid JSON manifest", async () => {
    const result = await loadManifest(join(fixturesDir, "valid.json"))
    expect(result).toEqual(JSON.parse(validManifestJson))
  })

  it("should load a TypeScript manifest with named export", async () => {
    const result = (await loadManifest(
      join(fixturesDir, "valid.ts"),
    )) as Record<string, unknown>
    expect(result.name).toBe("test-tool-ts")
  })

  it("should load a TypeScript manifest with default export", async () => {
    const result = (await loadManifest(
      join(fixturesDir, "default-export.ts"),
    )) as Record<string, unknown>
    expect(result.name).toBe("test-tool-default")
  })

  it("should exit with error for missing JSON file", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      loadManifest(join(fixturesDir, "nonexistent.json")),
    ).rejects.toThrow(ExitError)
  })

  it("should exit with error for invalid JSON", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      loadManifest(join(fixturesDir, "invalid.json")),
    ).rejects.toThrow(ExitError)
  })

  it("should exit with error for TS file with no manifest export", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      loadManifest(join(fixturesDir, "no-export.ts")),
    ).rejects.toThrow(ExitError)
  })

  it("should exit with error for missing TS file", async () => {
    vi.spyOn(process, "exit").mockImplementation(code => {
      throw new ExitError(code as number)
    })
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(
      loadManifest(join(fixturesDir, "nonexistent.ts")),
    ).rejects.toThrow(ExitError)
  })
})
