import { describe, expect, it } from "vitest"
import type { ToolManifest } from "../lib/manifest/types.js"
import { computeManifestHash } from "../lib/onchain/hash.js"

describe("computeManifestHash", () => {
  it("should match the free-tool test vector from the ERC spec", () => {
    const freeToolManifest = {
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
          updatedAt: {
            type: "string",
            format: "date-time",
          },
        },
      },
      version: "1.0.0",
      tags: ["nft", "pricing", "oracle"],
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    } as ToolManifest

    const hash = computeManifestHash(freeToolManifest)
    expect(hash).toBe(
      "0x85f160012d9fd30c7e82bc9d3959c90ec9df3c7d69009a343d8ee01904321290",
    )
  })

  it("should match the paid-tool test vector from the ERC spec", () => {
    const paidToolManifest = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "premium-analytics",
      description: "Advanced portfolio analytics for NFT holders.",
      endpoint: "https://tools.example.com/premium-analytics",
      inputs: {
        type: "object",
        properties: {
          wallet: {
            type: "string",
            description: "Wallet address to analyze",
          },
        },
        required: ["wallet"],
      },
      outputs: {
        type: "object",
        properties: {
          totalValue: { type: "string" },
          breakdown: { type: "array" },
        },
      },
      version: "1.0.0",
      tags: ["analytics", "portfolio"],
      pricing: [
        {
          amount: "20000",
          asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          recipient: "eip155:8453:0xabcdef0123456789abcdef0123456789abcdef01",
          protocol: "x402",
        },
        {
          amount: "20000",
          asset: "eip155:1/erc20:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
          recipient: "eip155:1:0xabcdef0123456789abcdef0123456789abcdef01",
          protocol: "x402",
        },
      ],
      creatorAddress: "0xabcdef0123456789abcdef0123456789abcdef01",
    } as ToolManifest

    const hash = computeManifestHash(paidToolManifest)
    expect(hash).toBe(
      "0xf5c2253fa557ef61e7b91fdfb3613c5a14acf6f986193a40aeb0b481dc6cbac3",
    )
  })

  it("should produce deterministic hashes", () => {
    const manifest = {
      type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
      name: "test",
      description: "A test tool",
      endpoint: "https://test.example.com",
      inputs: {},
      outputs: {},
      creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
    } as ToolManifest

    const hash1 = computeManifestHash(manifest)
    const hash2 = computeManifestHash(manifest)
    expect(hash1).toBe(hash2)
  })
})
