import { describe, expect, it } from "vitest"
import { defineManifest, validateManifest } from "../lib/manifest/index.js"

const validManifest = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "nft-price-oracle",
  description: "Returns estimated floor price for any NFT collection.",
  endpoint: "https://tools.example.com/nft-price-oracle",
  inputs: {
    type: "object",
    properties: {
      collection: {
        type: "string",
        description: "Contract address",
      },
      chainId: { type: "integer" },
    },
    required: ["collection", "chainId"],
  },
  outputs: {
    type: "object",
    properties: {
      floorPriceEth: { type: "string" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  version: "1.0.0",
  tags: ["nft", "pricing", "oracle"],
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
}

describe("validateManifest", () => {
  it("should validate a correct manifest", () => {
    const result = validateManifest(validManifest)
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.name).toBe("nft-price-oracle")
  })

  it("should reject manifest with missing name", () => {
    const { name, ...noName } = validManifest
    const result = validateManifest(noName)
    expect(result.success).toBe(false)
    if (result.success) throw new Error("expected failure")
    expect(result.error).toBeDefined()
  })

  it("should reject manifest with empty name", () => {
    const result = validateManifest({
      ...validManifest,
      name: "",
    })
    expect(result.success).toBe(false)
  })

  it("should reject manifest with name exceeding 128 chars", () => {
    const result = validateManifest({
      ...validManifest,
      name: "a".repeat(129),
    })
    expect(result.success).toBe(false)
  })

  it("should reject manifest with description exceeding 500 chars", () => {
    const result = validateManifest({
      ...validManifest,
      description: "a".repeat(501),
    })
    expect(result.success).toBe(false)
  })

  it("should reject http endpoint", () => {
    const result = validateManifest({
      ...validManifest,
      endpoint: "http://insecure.com/tool",
    })
    expect(result.success).toBe(false)
  })

  it("should reject invalid creatorAddress", () => {
    const result = validateManifest({
      ...validManifest,
      creatorAddress: "not-an-address",
    })
    expect(result.success).toBe(false)
  })

  it("should accept manifest with pricing", () => {
    const result = validateManifest({
      ...validManifest,
      pricing: [
        {
          amount: "20000",
          asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          recipient: "eip155:8453:0xabcdef0123456789abcdef0123456789abcdef01",
          protocol: "x402",
        },
      ],
    })
    expect(result.success).toBe(true)
    if (!result.success) throw new Error("expected success")
    expect(result.data.pricing).toHaveLength(1)
  })

  it("should accept manifest without optional fields", () => {
    const minimal = {
      name: "test-tool",
      description: "A test tool",
      endpoint: "https://test.example.com",
      inputs: {},
      outputs: {},
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    }
    const result = validateManifest(minimal)
    expect(result.success).toBe(true)
  })
})

describe("defineManifest", () => {
  it("should return the same manifest", () => {
    const result = defineManifest(
      validManifest as ReturnType<typeof defineManifest>,
    )
    expect(result).toEqual(validManifest)
  })
})
