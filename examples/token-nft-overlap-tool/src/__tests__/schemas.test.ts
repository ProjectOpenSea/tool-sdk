import { describe, expect, it } from "vitest"
import { InputSchema, OutputSchema } from "../schemas.js"

describe("InputSchema", () => {
  it("accepts a valid input with defaults", () => {
    const result = InputSchema.parse({
      tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      collectionSlug: "boredapeyachtclub",
    })
    expect(result.chain).toBe("ethereum")
    expect(result.maxPages).toBe(5)
    expect(result.tokenAddress).toBe(
      "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
    )
  })

  it("rejects an invalid address", () => {
    expect(() =>
      InputSchema.parse({
        tokenAddress: "not-an-address",
        collectionSlug: "test",
      }),
    ).toThrow()
  })

  it("rejects maxPages above 20", () => {
    expect(() =>
      InputSchema.parse({
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        collectionSlug: "test",
        maxPages: 25,
      }),
    ).toThrow()
  })

  it("rejects an empty collectionSlug", () => {
    expect(() =>
      InputSchema.parse({
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        collectionSlug: "",
      }),
    ).toThrow()
  })

  it("rejects an unknown chain", () => {
    expect(() =>
      InputSchema.parse({
        chain: "../../admin",
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        collectionSlug: "test",
      }),
    ).toThrow()
  })

  it("accepts a valid non-default chain", () => {
    const result = InputSchema.parse({
      chain: "base",
      tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      collectionSlug: "test",
    })
    expect(result.chain).toBe("base")
  })

  it("rejects collectionSlug with path traversal", () => {
    expect(() =>
      InputSchema.parse({
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        collectionSlug: "../../../admin",
      }),
    ).toThrow()
  })

  it("rejects collectionSlug with uppercase", () => {
    expect(() =>
      InputSchema.parse({
        tokenAddress: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
        collectionSlug: "BoredApeYachtClub",
      }),
    ).toThrow()
  })
})

describe("OutputSchema", () => {
  const validOutput = {
    token: {
      address: "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
      name: "USD Coin",
      symbol: "USDC",
      totalHoldersFetched: 100,
    },
    collection: {
      slug: "boredapeyachtclub",
      name: "Bored Ape Yacht Club",
      floorPriceEth: 12.5,
      totalHoldersFetched: 200,
    },
    overlap: {
      count: 5,
      wallets: [
        {
          address: "0x1234567890123456789012345678901234567890",
          username: "alice",
          tokenQuantity: 1000,
          tokenUsdValue: 1000,
          nftCount: 3,
          nftOwnershipPct: 0.03,
        },
      ],
    },
    stats: {
      overlapRate: 0.05,
      reverseOverlapRate: 0.025,
    },
  }

  it("accepts a valid output", () => {
    expect(() => OutputSchema.parse(validOutput)).not.toThrow()
  })

  it("accepts null floorPriceEth", () => {
    const output = {
      ...validOutput,
      collection: { ...validOutput.collection, floorPriceEth: null },
    }
    expect(() => OutputSchema.parse(output)).not.toThrow()
  })

  it("accepts null username in wallets", () => {
    const output = {
      ...validOutput,
      overlap: {
        count: 1,
        wallets: [{ ...validOutput.overlap.wallets[0], username: null }],
      },
    }
    expect(() => OutputSchema.parse(output)).not.toThrow()
  })
})
