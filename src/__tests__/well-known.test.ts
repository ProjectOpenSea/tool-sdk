import { describe, expect, it } from "vitest"
import type { ToolManifest } from "../lib/manifest/types.js"
import { createWellKnownHandler } from "../lib/middleware/well-known.js"

const testManifest = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "nft-price-oracle",
  description: "Returns estimated floor price for any NFT collection.",
  endpoint: "https://tools.example.com/nft-price-oracle",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
} as ToolManifest

describe("createWellKnownHandler", () => {
  it("should return manifest at correct slug path", () => {
    const handler = createWellKnownHandler(testManifest)
    const request = new Request(
      "https://tools.example.com/.well-known/ai-tool/nft-price-oracle.json",
    )
    const response = handler(request)

    expect(response.status).toBe(200)
    expect(response.headers.get("Content-Type")).toBe("application/json")
  })

  it("should return 404 for wrong slug", () => {
    const handler = createWellKnownHandler(testManifest)
    const request = new Request(
      "https://tools.example.com/.well-known/ai-tool/wrong-slug.json",
    )
    const response = handler(request)

    expect(response.status).toBe(404)
  })

  it("should derive slug correctly (spaces to hyphens)", () => {
    const manifest = {
      ...testManifest,
      name: "My Cool Tool",
    } as ToolManifest
    const handler = createWellKnownHandler(manifest)
    const request = new Request(
      "https://example.com/.well-known/ai-tool/my-cool-tool.json",
    )
    const response = handler(request)

    expect(response.status).toBe(200)
  })

  it("should derive slug correctly (remove non-alphanumeric)", () => {
    const manifest = {
      ...testManifest,
      name: "Tool@v2.0!",
    } as ToolManifest
    const handler = createWellKnownHandler(manifest)
    const request = new Request(
      "https://example.com/.well-known/ai-tool/toolv20.json",
    )
    const response = handler(request)

    expect(response.status).toBe(200)
  })

  it("should return manifest body as JSON", async () => {
    const handler = createWellKnownHandler(testManifest)
    const request = new Request(
      "https://tools.example.com/.well-known/ai-tool/nft-price-oracle.json",
    )
    const response = handler(request)
    const body = await response.json()

    expect(body.name).toBe("nft-price-oracle")
    expect(body.endpoint).toBe("https://tools.example.com/nft-price-oracle")
  })
})
