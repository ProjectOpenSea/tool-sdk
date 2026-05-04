import type { Address, Hash } from "viem"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const mockReadContract = vi.fn()
const mockWriteContract = vi.fn()

vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>()
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mockReadContract,
    }),
  }
})

const TEST_TOOL_ID = 7n
const COLLECTION_A: Address = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
const COLLECTION_B: Address = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"
const TX_HASH: Hash =
  "0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"

const mockWalletClient = {
  account: {
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266" as Address,
  },
  writeContract: mockWriteContract,
} as never

beforeEach(() => {
  mockReadContract.mockReset()
  mockWriteContract.mockReset()
  mockWriteContract.mockResolvedValue(TX_HASH)
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("ERC721OwnerPredicateClient", () => {
  it("uses the default Base deployment address", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const client = new ERC721OwnerPredicateClient()
    expect(client).toBeDefined()
  })

  it("accepts a custom predicateAddress override", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const custom = "0x1111111111111111111111111111111111111111" as const
    const client = new ERC721OwnerPredicateClient({
      predicateAddress: custom,
    })
    expect(client).toBeDefined()
  })

  it("throws when chain has no deployment and no override", async () => {
    const { ERC721OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    expect(
      () =>
        new ERC721OwnerPredicateClient({
          chain: {
            id: 999999,
            name: "test",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: [] } },
          },
        }),
    ).toThrow("ERC721OwnerPredicate is not deployed on chain 999999")
  })

  describe("getCollections", () => {
    it("returns collections for a tool", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A, COLLECTION_B])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient()
      const collections = await client.getCollections(TEST_TOOL_ID)

      expect(collections).toEqual([COLLECTION_A, COLLECTION_B])
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getCollections",
          args: [TEST_TOOL_ID],
        }),
      )
    })

    it("returns empty array when no collections are set", async () => {
      mockReadContract.mockResolvedValueOnce([])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient()
      const collections = await client.getCollections(TEST_TOOL_ID)

      expect(collections).toEqual([])
    })
  })

  describe("setCollections", () => {
    it("writes collections and returns tx hash", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const hash = await client.setCollections(TEST_TOOL_ID, [
        COLLECTION_A,
        COLLECTION_B,
      ])

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "setCollections",
          args: [TEST_TOOL_ID, [COLLECTION_A, COLLECTION_B]],
        }),
      )
    })

    it("throws without walletClient", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient()

      await expect(
        client.setCollections(TEST_TOOL_ID, [COLLECTION_A]),
      ).rejects.toThrow("walletClient required for write operations")
    })
  })

  describe("addCollection", () => {
    it("reads current collections, appends, and writes", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const hash = await client.addCollection(TEST_TOOL_ID, COLLECTION_B)

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "setCollections",
          args: [TEST_TOOL_ID, [COLLECTION_A, COLLECTION_B]],
        }),
      )
    })

    it("works when no collections exist yet", async () => {
      mockReadContract.mockResolvedValueOnce([])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const hash = await client.addCollection(TEST_TOOL_ID, COLLECTION_A)

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [TEST_TOOL_ID, [COLLECTION_A]],
        }),
      )
    })

    it("throws when collection is already present", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })

      await expect(
        client.addCollection(TEST_TOOL_ID, COLLECTION_A),
      ).rejects.toThrow(
        `Collection ${COLLECTION_A} is already in the list for tool ${TEST_TOOL_ID}`,
      )
      expect(mockWriteContract).not.toHaveBeenCalled()
    })

    it("detects duplicates case-insensitively", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const lowerCase = COLLECTION_A.toLowerCase() as Address

      await expect(
        client.addCollection(TEST_TOOL_ID, lowerCase),
      ).rejects.toThrow("is already in the list")
      expect(mockWriteContract).not.toHaveBeenCalled()
    })
  })

  describe("removeCollection", () => {
    it("reads current collections, filters, and writes", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A, COLLECTION_B])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const hash = await client.removeCollection(TEST_TOOL_ID, COLLECTION_A)

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [TEST_TOOL_ID, [COLLECTION_B]],
        }),
      )
    })

    it("handles case-insensitive address matching", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const lowerCase = COLLECTION_A.toLowerCase() as Address
      const hash = await client.removeCollection(TEST_TOOL_ID, lowerCase)

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          args: [TEST_TOOL_ID, []],
        }),
      )
    })

    it("throws when address is not found", async () => {
      mockReadContract.mockResolvedValueOnce([COLLECTION_A])

      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        walletClient: mockWalletClient,
      })

      await expect(
        client.removeCollection(TEST_TOOL_ID, COLLECTION_B),
      ).rejects.toThrow(
        `Collection ${COLLECTION_B} not found in the list for tool ${TEST_TOOL_ID}`,
      )
      expect(mockWriteContract).not.toHaveBeenCalled()
    })
  })
})

describe("ERC1155OwnerPredicateClient", () => {
  it("uses the default Base deployment address", async () => {
    const { ERC1155OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const client = new ERC1155OwnerPredicateClient()
    expect(client).toBeDefined()
  })

  it("accepts a custom predicateAddress override", async () => {
    const { ERC1155OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const custom = "0x2222222222222222222222222222222222222222" as const
    const client = new ERC1155OwnerPredicateClient({
      predicateAddress: custom,
    })
    expect(client).toBeDefined()
  })

  it("throws when chain has no deployment and no override", async () => {
    const { ERC1155OwnerPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    expect(
      () =>
        new ERC1155OwnerPredicateClient({
          chain: {
            id: 999999,
            name: "test",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: [] } },
          },
        }),
    ).toThrow("ERC1155OwnerPredicate is not deployed on chain 999999")
  })

  describe("getCollectionTokens", () => {
    it("returns collection tokens for a tool", async () => {
      const entries = [
        { collection: COLLECTION_A, tokenIds: [1n, 2n] },
        { collection: COLLECTION_B, tokenIds: [42n] },
      ]
      mockReadContract.mockResolvedValueOnce(entries)

      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient()
      const result = await client.getCollectionTokens(TEST_TOOL_ID)

      expect(result).toEqual([
        { collection: COLLECTION_A, tokenIds: [1n, 2n] },
        { collection: COLLECTION_B, tokenIds: [42n] },
      ])
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getCollectionTokens",
          args: [TEST_TOOL_ID],
        }),
      )
    })

    it("returns empty array when no entries are set", async () => {
      mockReadContract.mockResolvedValueOnce([])

      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient()
      const result = await client.getCollectionTokens(TEST_TOOL_ID)

      expect(result).toEqual([])
    })
  })

  describe("setCollectionTokens", () => {
    it("writes entries and returns tx hash", async () => {
      const entries = [{ collection: COLLECTION_A, tokenIds: [1n, 2n] }]

      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient({
        walletClient: mockWalletClient,
      })
      const hash = await client.setCollectionTokens(TEST_TOOL_ID, entries)

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "setCollectionTokens",
          args: [TEST_TOOL_ID, entries],
        }),
      )
    })

    it("throws without walletClient", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient()

      await expect(
        client.setCollectionTokens(TEST_TOOL_ID, []),
      ).rejects.toThrow("walletClient required for write operations")
    })
  })
})
