import type { Address, Chain, Hash } from "viem"
import { encodeAbiParameters, getAddress } from "viem"
import { mainnet, polygon } from "viem/chains"
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

const DUMMY_PREDICATE: Address = "0x3333333333333333333333333333333333333333"

const CHECKSUMMED_A = getAddress(COLLECTION_A)

const UNKNOWN_CHAIN: Chain = {
  id: 43114,
  name: "Avalanche",
  nativeCurrency: { name: "AVAX", symbol: "AVAX", decimals: 18 },
  rpcUrls: { default: { http: [] } },
}

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

  describe("toManifestAccess", () => {
    it("returns access with opensea link on Base", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient()
      const access = client.toManifestAccess(CHECKSUMMED_A)

      expect(access.logic).toBe("OR")
      expect(access.requirements).toHaveLength(1)
      expect(access.requirements[0].kind).toBe("0xbdf8c428")
      expect(access.requirements[0].data).toBe(
        encodeAbiParameters([{ type: "address" }], [CHECKSUMMED_A]),
      )
      expect(access.requirements[0].label).toBe(
        "Hold any NFT from this collection",
      )
      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/base/${CHECKSUMMED_A}`,
      })
    })

    it("returns access with opensea link on Ethereum", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        chain: mainnet,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A)

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/ethereum/${CHECKSUMMED_A}`,
      })
    })

    it("returns access with opensea link on Polygon", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        chain: polygon,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A)

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/matic/${CHECKSUMMED_A}`,
      })
    })

    it("omits opensea link for unknown chains", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient({
        chain: UNKNOWN_CHAIN,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A)

      expect(access.requirements[0].links).toBeUndefined()
    })

    it("uses custom label when provided", async () => {
      const { ERC721OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC721OwnerPredicateClient()
      const access = client.toManifestAccess(CHECKSUMMED_A, {
        label: "Must hold a Chonk",
      })

      expect(access.requirements[0].label).toBe("Must hold a Chonk")
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

  describe("toManifestAccess", () => {
    it("returns access with opensea link on Base", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient()
      const access = client.toManifestAccess(CHECKSUMMED_A, 42n)

      expect(access.logic).toBe("OR")
      expect(access.requirements).toHaveLength(1)
      expect(access.requirements[0].kind).toBe("0xcb429230")
      expect(access.requirements[0].data).toBe(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint256" }],
          [CHECKSUMMED_A, 42n],
        ),
      )
      expect(access.requirements[0].label).toBe(
        "Hold token #42 from this collection",
      )
      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/base/${CHECKSUMMED_A}`,
      })
    })

    it("returns access with opensea link on Ethereum", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient({
        chain: mainnet,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 1n)

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/ethereum/${CHECKSUMMED_A}`,
      })
    })

    it("returns access with opensea link on Polygon", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient({
        chain: polygon,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 1n)

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/matic/${CHECKSUMMED_A}`,
      })
    })

    it("omits opensea link for unknown chains", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient({
        chain: UNKNOWN_CHAIN,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 1n)

      expect(access.requirements[0].links).toBeUndefined()
    })

    it("includes token ID in default label", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient()
      const access = client.toManifestAccess(CHECKSUMMED_A, 99n)

      expect(access.requirements[0].label).toBe(
        "Hold token #99 from this collection",
      )
    })

    it("uses custom label when provided", async () => {
      const { ERC1155OwnerPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC1155OwnerPredicateClient()
      const access = client.toManifestAccess(CHECKSUMMED_A, 1n, {
        label: "Must hold a VIP pass",
      })

      expect(access.requirements[0].label).toBe("Must hold a VIP pass")
    })
  })
})
