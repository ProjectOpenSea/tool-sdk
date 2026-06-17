import { describe, expect, it } from "vitest"
import { buildManifest, GATE_COLLECTION } from "../manifest.js"

describe("buildManifest", () => {
  const manifest = buildManifest({
    creator: "0x1111111111111111111111111111111111111111",
    endpoint: "https://example.com/api",
  })

  it("sets pricing to empty array (free tool)", () => {
    expect(manifest.pricing).toEqual([])
  })

  it("includes ERC721 access requirement for the gate collection", () => {
    expect(manifest.access).toBeDefined()
    // `ManifestDefinition["access"]` is typed loosely as `{}`; the structured
    // shape is validated at runtime by the manifest schema. Narrow it here.
    const requirements = (
      manifest.access as { requirements?: { kind: string }[] } | undefined
    )?.requirements
    expect(requirements).toHaveLength(1)
    const req = requirements?.[0]
    expect(req?.kind).toBe("0xbdf8c428")
  })

  it("uses the correct gate collection address", () => {
    expect(GATE_COLLECTION).toBe("0xd9b78a2f1dafc8bb9c60961790d2beefebee56f4")
  })

  it("sets the correct tool name", () => {
    expect(manifest.name).toBe("token-nft-overlap")
  })

  it("includes the creator address", () => {
    expect(manifest.creatorAddress).toBe(
      "0x1111111111111111111111111111111111111111",
    )
  })

  it("sets the endpoint", () => {
    expect(manifest.endpoint).toBe("https://example.com/api")
  })
})
