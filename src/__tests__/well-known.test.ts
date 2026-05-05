import { describe, expect, it } from "vitest"
import type { ManifestDefinition } from "../lib/manifest/index.js"
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

  it("should accept ManifestDefinition with EnvResolver lambdas", async () => {
    const definition: ManifestDefinition = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "lambda-tool",
      description: "A tool with lambda fields",
      endpoint: env => env.TOOL_ENDPOINT ?? "https://fallback.example.com",
      inputs: {},
      outputs: {},
      creatorAddress: env =>
        (env.CREATOR_ADDRESS as `0x${string}`) ??
        "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const handler = createWellKnownHandler(definition)
    const request = new Request(
      "https://example.com/.well-known/ai-tool/lambda-tool.json",
    )
    const response = handler(request)

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.name).toBe("lambda-tool")
    expect(body.endpoint).toBe("https://fallback.example.com")
    expect(body.creatorAddress).toBe(
      "0xabcdefabcdef1234567890abcdefabcdef123456",
    )
  })

  it("should accept explicit env for non-Node runtimes", async () => {
    const definition: ManifestDefinition = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "cf-tool",
      description: "Cloudflare Workers tool",
      endpoint: env => env.TOOL_ENDPOINT!,
      inputs: {},
      outputs: {},
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const workerEnv = { TOOL_ENDPOINT: "https://cf.example.com/api" }
    const handler = createWellKnownHandler(definition, { env: workerEnv })
    const response = handler(
      new Request("https://cf.example.com/.well-known/ai-tool/cf-tool.json"),
    )

    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.endpoint).toBe("https://cf.example.com/api")
  })

  it("should resolve ManifestDefinition only once (cached)", async () => {
    let callCount = 0
    const definition: ManifestDefinition = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "cached-tool",
      description: "Tests caching",
      endpoint: env => {
        callCount++
        return env.TOOL_ENDPOINT ?? "https://cached.example.com"
      },
      inputs: {},
      outputs: {},
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }

    const handler = createWellKnownHandler(definition)
    handler(
      new Request("https://example.com/.well-known/ai-tool/cached-tool.json"),
    )
    handler(
      new Request("https://example.com/.well-known/ai-tool/cached-tool.json"),
    )
    handler(
      new Request("https://example.com/.well-known/ai-tool/cached-tool.json"),
    )

    expect(callCount).toBe(1)
  })
})
