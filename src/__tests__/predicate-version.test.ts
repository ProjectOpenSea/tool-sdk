import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockReadContract = vi.fn()

vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>()
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mockReadContract,
    }),
  }
})

beforeEach(() => {
  mockReadContract.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("getPredicateForRegistryVersion", () => {
  it("returns v0.1 ERC721 predicate for registry version 0.1", async () => {
    const { getPredicateForRegistryVersion, ERC721_OWNER_PREDICATE_V1 } =
      await import("../lib/onchain/chains.js")

    const result = getPredicateForRegistryVersion("0.1", "erc721")
    expect(result).toBe(ERC721_OWNER_PREDICATE_V1)
    expect(result.address).toBe("0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88")
  })

  it("returns v0.2 ERC721 predicate for registry version 0.2", async () => {
    const { getPredicateForRegistryVersion, ERC721_OWNER_PREDICATE } =
      await import("../lib/onchain/chains.js")

    const result = getPredicateForRegistryVersion("0.2", "erc721")
    expect(result).toBe(ERC721_OWNER_PREDICATE)
    expect(result.address).toBe("0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769")
  })

  it("falls back to v0.2 with a warning for unrecognized registry version", async () => {
    const { getPredicateForRegistryVersion, ERC721_OWNER_PREDICATE } =
      await import("../lib/onchain/chains.js")

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const result = getPredicateForRegistryVersion("99.0", "erc721")
    expect(result).toBe(ERC721_OWNER_PREDICATE)
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Unknown registry version "99.0"'),
    )
    warnSpy.mockRestore()
  })

  it("returns correct ERC1155 predicate for each version", async () => {
    const { getPredicateForRegistryVersion, ERC1155_OWNER_PREDICATE } =
      await import("../lib/onchain/chains.js")

    const v01 = getPredicateForRegistryVersion("0.1", "erc1155")
    const v02 = getPredicateForRegistryVersion("0.2", "erc1155")

    expect(v01).toBe(ERC1155_OWNER_PREDICATE)
    expect(v02).toBe(ERC1155_OWNER_PREDICATE)
  })
})

describe("ERC721OwnerPredicateClient with registryVersion", () => {
  it("uses v0.1 predicate address when registryVersion is 0.1", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const { ERC721_OWNER_PREDICATE_V1, deploymentAddress } = await import(
      "../lib/onchain/chains.js"
    )

    const client = new ERC721OwnerPredicateClient({
      registryVersion: "0.1",
    })

    const expectedAddr = deploymentAddress(ERC721_OWNER_PREDICATE_V1, 8453)
    expect(expectedAddr).toBe("0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88")

    mockReadContract.mockResolvedValueOnce([])
    await client.getCollections(1n)

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
        functionName: "getCollections",
      }),
    )
  })

  it("uses v0.2 predicate address when registryVersion is 0.2", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )

    const client = new ERC721OwnerPredicateClient({
      registryVersion: "0.2",
    })

    mockReadContract.mockResolvedValueOnce([])
    await client.getCollections(1n)

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769",
        functionName: "getCollections",
      }),
    )
  })

  it("prefers explicit predicateAddress over registryVersion", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )

    const customAddr =
      "0x1111111111111111111111111111111111111111" as `0x${string}`
    const client = new ERC721OwnerPredicateClient({
      registryVersion: "0.1",
      predicateAddress: customAddr,
    })

    mockReadContract.mockResolvedValueOnce([])
    await client.getCollections(1n)

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: customAddr,
        functionName: "getCollections",
      }),
    )
  })

  it("uses default (v0.2) deployment when no registryVersion is set", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )

    const client = new ERC721OwnerPredicateClient()

    mockReadContract.mockResolvedValueOnce([])
    await client.getCollections(1n)

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: "0xd1F703D0B90BB7106fAebBfbcAdD2B07BDc4c769",
        functionName: "getCollections",
      }),
    )
  })
})
