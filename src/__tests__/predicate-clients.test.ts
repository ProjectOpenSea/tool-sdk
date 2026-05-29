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

describe("SubscriptionPredicateClient", () => {
  it("resolves to the canonical address on Base and mainnet by default", async () => {
    const { SubscriptionPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const { SUBSCRIPTION_PREDICATE } = await import("../lib/onchain/chains.js")

    const baseClient = new SubscriptionPredicateClient({
      walletClient: mockWalletClient,
    })
    await baseClient.configureToolGating(TEST_TOOL_ID, COLLECTION_A, 0)
    expect(mockWriteContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: SUBSCRIPTION_PREDICATE.address }),
    )

    const mainnetClient = new SubscriptionPredicateClient({
      chain: mainnet,
      walletClient: mockWalletClient,
    })
    await mainnetClient.configureToolGating(TEST_TOOL_ID, COLLECTION_A, 0)
    expect(mockWriteContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: SUBSCRIPTION_PREDICATE.address }),
    )
  })

  it("accepts a custom predicateAddress override", async () => {
    const { SubscriptionPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const client = new SubscriptionPredicateClient({
      predicateAddress: DUMMY_PREDICATE,
      walletClient: mockWalletClient,
    })
    await client.configureToolGating(TEST_TOOL_ID, COLLECTION_A, 0)
    expect(mockWriteContract).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: DUMMY_PREDICATE }),
    )
  })

  it("throws when chain has no deployment and no override", async () => {
    const { SubscriptionPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    expect(
      () =>
        new SubscriptionPredicateClient({
          chain: {
            id: 999999,
            name: "test",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: [] } },
          },
        }),
    ).toThrow("SubscriptionPredicate is not deployed on chain 999999")
  })

  describe("configureToolGating", () => {
    it("writes gating config and returns tx hash", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
        walletClient: mockWalletClient,
      })
      const hash = await client.configureToolGating(
        TEST_TOOL_ID,
        COLLECTION_A,
        2,
      )

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "configureToolGating",
          args: [TEST_TOOL_ID, COLLECTION_A, 2],
        }),
      )
    })

    it("throws without walletClient", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })

      await expect(
        client.configureToolGating(TEST_TOOL_ID, COLLECTION_A, 0),
      ).rejects.toThrow("walletClient required for write operations")
    })
  })

  describe("getToolGatingConfig", () => {
    it("returns collection and minTier", async () => {
      mockReadContract.mockResolvedValueOnce({
        collection: COLLECTION_A,
        minTier: 3,
      })

      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const config = await client.getToolGatingConfig(TEST_TOOL_ID)

      expect(config).toEqual({ collection: COLLECTION_A, minTier: 3 })
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getToolGatingConfig",
          args: [TEST_TOOL_ID],
        }),
      )
    })
  })

  describe("getSubscriptionStatus", () => {
    it("maps tuple indices to named fields", async () => {
      const ACCOUNT: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
      mockReadContract.mockResolvedValueOnce([true, 2, 1, 1700000000n, true])

      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const status = await client.getSubscriptionStatus(TEST_TOOL_ID, ACCOUNT)

      expect(status).toEqual({
        hasNft: true,
        tier: 2,
        requiredTier: 1,
        expiration: 1700000000n,
        active: true,
      })
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getSubscriptionStatus",
          args: [TEST_TOOL_ID, ACCOUNT],
        }),
      )
    })

    it("returns inactive status when user has no NFT", async () => {
      const ACCOUNT: Address = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"
      mockReadContract.mockResolvedValueOnce([false, 0, 1, 0n, false])

      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const status = await client.getSubscriptionStatus(TEST_TOOL_ID, ACCOUNT)

      expect(status.hasNft).toBe(false)
      expect(status.active).toBe(false)
      expect(status.expiration).toBe(0n)
    })
  })

  describe("toManifestAccess", () => {
    it("returns access with SUBSCRIPTION_KIND and AND logic", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 0)

      expect(access.logic).toBe("AND")
      expect(access.requirements).toHaveLength(1)
      expect(access.requirements[0].kind).toBe("0x44387cc2")
      expect(access.requirements[0].data).toBe(
        encodeAbiParameters(
          [{ type: "address" }, { type: "uint8" }],
          [CHECKSUMMED_A, 0],
        ),
      )
      expect(access.requirements[0].label).toBe("Active subscription")
    })

    it("includes tier in label when minTier > 0", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 3)

      expect(access.requirements[0].label).toBe("Active subscription (tier 3+)")
    })

    it("uses custom label when provided", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 2, {
        label: "Pro subscription required",
      })

      expect(access.requirements[0].label).toBe("Pro subscription required")
    })

    it("returns access with opensea link on Base", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 0)

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/base/${CHECKSUMMED_A}`,
      })
    })

    it("omits opensea link for unknown chains", async () => {
      const { SubscriptionPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new SubscriptionPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
        chain: UNKNOWN_CHAIN,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, 0)

      expect(access.requirements[0].links).toBeUndefined()
    })
  })
})

describe("CompositePredicateClient", () => {
  it("requires predicateAddress (no canonical deployment)", async () => {
    const { CompositePredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    expect(
      () =>
        new CompositePredicateClient({
          predicateAddress: DUMMY_PREDICATE,
        }),
    ).not.toThrow()
  })

  describe("getOp", () => {
    it("returns CompositeOp.ALL (0)", async () => {
      mockReadContract.mockResolvedValueOnce(0)

      const { CompositePredicateClient, CompositeOp } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new CompositePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const op = await client.getOp(TEST_TOOL_ID)

      expect(op).toBe(CompositeOp.ALL)
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getOp",
          args: [TEST_TOOL_ID],
        }),
      )
    })

    it("returns CompositeOp.ANY (1)", async () => {
      mockReadContract.mockResolvedValueOnce(1)

      const { CompositePredicateClient, CompositeOp } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new CompositePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const op = await client.getOp(TEST_TOOL_ID)

      expect(op).toBe(CompositeOp.ANY)
    })
  })

  describe("getTerms", () => {
    it("returns mapped terms with predicate and negate", async () => {
      mockReadContract.mockResolvedValueOnce([
        { predicate: COLLECTION_A, negate: false },
        { predicate: COLLECTION_B, negate: true },
      ])

      const { CompositePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new CompositePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const terms = await client.getTerms(TEST_TOOL_ID)

      expect(terms).toEqual([
        { predicate: COLLECTION_A, negate: false },
        { predicate: COLLECTION_B, negate: true },
      ])
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getTerms",
          args: [TEST_TOOL_ID],
        }),
      )
    })

    it("returns empty array when no terms are set", async () => {
      mockReadContract.mockResolvedValueOnce([])

      const { CompositePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new CompositePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const terms = await client.getTerms(TEST_TOOL_ID)

      expect(terms).toEqual([])
    })
  })

  describe("setComposition", () => {
    it("writes composition and returns tx hash", async () => {
      const { CompositePredicateClient, CompositeOp } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new CompositePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
        walletClient: mockWalletClient,
      })
      const terms = [
        { predicate: COLLECTION_A, negate: false },
        { predicate: COLLECTION_B, negate: true },
      ]
      const hash = await client.setComposition(
        TEST_TOOL_ID,
        CompositeOp.ANY,
        terms,
      )

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "setComposition",
          args: [
            TEST_TOOL_ID,
            CompositeOp.ANY,
            [
              { predicate: COLLECTION_A, negate: false },
              { predicate: COLLECTION_B, negate: true },
            ],
          ],
        }),
      )
    })

    it("throws without walletClient", async () => {
      const { CompositePredicateClient, CompositeOp } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new CompositePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })

      await expect(
        client.setComposition(TEST_TOOL_ID, CompositeOp.ALL, []),
      ).rejects.toThrow("walletClient required for write operations")
    })
  })
})

const TRAITS_CONTRACT: Address = getAddress(
  "0xCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC",
)
const TRAIT_KEY =
  "0x7469657200000000000000000000000000000000000000000000000000000000" as const
const ALLOWED_VALUES = [
  "0x5261726500000000000000000000000000000000000000000000000000000000" as const,
  "0x4c6567656e646172790000000000000000000000000000000000000000000000" as const,
]

describe("TraitGatedPredicateClient", () => {
  it("defaults to canonical deployment when predicateAddress omitted", async () => {
    const { TraitGatedPredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const { TRAIT_GATED_PREDICATE } = await import("../lib/onchain/chains.js")
    mockReadContract.mockResolvedValueOnce({
      collection: COLLECTION_A,
      traitsContract: TRAITS_CONTRACT,
      traitKey: TRAIT_KEY,
      allowedValues: ALLOWED_VALUES,
    })
    const client = new TraitGatedPredicateClient()
    await client.getToolTraitConfig(TEST_TOOL_ID)
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: TRAIT_GATED_PREDICATE.address }),
    )
  })

  describe("getToolTraitConfig", () => {
    it("returns config for a tool", async () => {
      mockReadContract.mockResolvedValueOnce({
        collection: COLLECTION_A,
        traitsContract: TRAITS_CONTRACT,
        traitKey: TRAIT_KEY,
        allowedValues: ALLOWED_VALUES,
      })

      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const config = await client.getToolTraitConfig(TEST_TOOL_ID)

      expect(config).toEqual({
        collection: COLLECTION_A,
        traitsContract: TRAITS_CONTRACT,
        traitKey: TRAIT_KEY,
        allowedValues: ALLOWED_VALUES,
      })
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getToolTraitConfig",
          args: [TEST_TOOL_ID],
        }),
      )
    })
  })

  describe("configureToolTrait", () => {
    it("writes config and returns tx hash", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
        walletClient: mockWalletClient,
      })
      const hash = await client.configureToolTrait(
        TEST_TOOL_ID,
        COLLECTION_A,
        TRAITS_CONTRACT,
        TRAIT_KEY,
        [...ALLOWED_VALUES],
      )

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "configureToolTrait",
          args: [
            TEST_TOOL_ID,
            COLLECTION_A,
            TRAITS_CONTRACT,
            TRAIT_KEY,
            ALLOWED_VALUES,
          ],
        }),
      )
    })

    it("throws without walletClient", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })

      await expect(
        client.configureToolTrait(
          TEST_TOOL_ID,
          COLLECTION_A,
          TRAITS_CONTRACT,
          TRAIT_KEY,
          [...ALLOWED_VALUES],
        ),
      ).rejects.toThrow("walletClient required for write operations")
    })
  })

  describe("toManifestAccess", () => {
    it("returns access with correct kind and data", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(
        CHECKSUMMED_A,
        TRAITS_CONTRACT,
        TRAIT_KEY,
        [...ALLOWED_VALUES],
      )

      expect(access.logic).toBe("AND")
      expect(access.requirements).toHaveLength(1)
      expect(access.requirements[0].kind).toBe("0x37d8dc22")
      expect(access.requirements[0].label).toBe(
        "Hold an NFT with a matching trait",
      )
    })

    it("returns opensea link on Base", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(
        CHECKSUMMED_A,
        TRAITS_CONTRACT,
        TRAIT_KEY,
        [...ALLOWED_VALUES],
      )

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/base/${CHECKSUMMED_A}`,
      })
    })

    it("returns opensea link on Ethereum", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        chain: mainnet,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(
        CHECKSUMMED_A,
        TRAITS_CONTRACT,
        TRAIT_KEY,
        [...ALLOWED_VALUES],
      )

      expect(access.requirements[0].links).toEqual({
        opensea: `https://opensea.io/assets/ethereum/${CHECKSUMMED_A}`,
      })
    })

    it("omits opensea link for unknown chains", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        chain: UNKNOWN_CHAIN,
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(
        CHECKSUMMED_A,
        TRAITS_CONTRACT,
        TRAIT_KEY,
        [...ALLOWED_VALUES],
      )

      expect(access.requirements[0].links).toBeUndefined()
    })

    it("uses custom label when provided", async () => {
      const { TraitGatedPredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new TraitGatedPredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(
        CHECKSUMMED_A,
        TRAITS_CONTRACT,
        TRAIT_KEY,
        [...ALLOWED_VALUES],
        { label: "Rare tier required" },
      )

      expect(access.requirements[0].label).toBe("Rare tier required")
    })
  })
})

const MIN_BALANCE = 1000000000000000000n // 1e18

describe("ERC20BalancePredicateClient", () => {
  it("uses the default Base deployment address", async () => {
    const { ERC20BalancePredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    const client = new ERC20BalancePredicateClient()
    expect(client).toBeDefined()
  })

  it("accepts a custom predicateAddress override", async () => {
    const { ERC20BalancePredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    expect(
      () =>
        new ERC20BalancePredicateClient({
          predicateAddress: DUMMY_PREDICATE,
        }),
    ).not.toThrow()
  })

  it("throws when chain has no deployment and no override", async () => {
    const { ERC20BalancePredicateClient } = await import(
      "../lib/onchain/predicate-clients.js"
    )
    expect(
      () =>
        new ERC20BalancePredicateClient({
          chain: {
            id: 999999,
            name: "test",
            nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
            rpcUrls: { default: { http: [] } },
          },
        }),
    ).toThrow("ERC20BalancePredicate is not deployed on chain 999999")
  })

  describe("getToolERC20Config", () => {
    it("returns config for a tool", async () => {
      mockReadContract.mockResolvedValueOnce({
        token: COLLECTION_A,
        minBalance: MIN_BALANCE,
      })

      const { ERC20BalancePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC20BalancePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const config = await client.getToolERC20Config(TEST_TOOL_ID)

      expect(config).toEqual({
        token: COLLECTION_A,
        minBalance: MIN_BALANCE,
      })
      expect(mockReadContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "getToolERC20Config",
          args: [TEST_TOOL_ID],
        }),
      )
    })
  })

  describe("configureToolERC20", () => {
    it("writes config and returns tx hash", async () => {
      const { ERC20BalancePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC20BalancePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
        walletClient: mockWalletClient,
      })
      const hash = await client.configureToolERC20(
        TEST_TOOL_ID,
        COLLECTION_A,
        MIN_BALANCE,
      )

      expect(hash).toBe(TX_HASH)
      expect(mockWriteContract).toHaveBeenCalledWith(
        expect.objectContaining({
          functionName: "configureToolERC20",
          args: [TEST_TOOL_ID, COLLECTION_A, MIN_BALANCE],
        }),
      )
    })

    it("throws without walletClient", async () => {
      const { ERC20BalancePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC20BalancePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })

      await expect(
        client.configureToolERC20(TEST_TOOL_ID, COLLECTION_A, MIN_BALANCE),
      ).rejects.toThrow("walletClient required for write operations")
    })
  })

  describe("toManifestAccess", () => {
    it("returns access with correct kind and data", async () => {
      const { ERC20BalancePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC20BalancePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, MIN_BALANCE)

      expect(access.logic).toBe("AND")
      expect(access.requirements).toHaveLength(1)
      expect(access.requirements[0].kind).toBe("0x812b02ee")
      expect(access.requirements[0].label).toBe(
        `Hold at least ${MIN_BALANCE} of this token`,
      )
    })

    it("does not include opensea link", async () => {
      const { ERC20BalancePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC20BalancePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, MIN_BALANCE)

      expect(access.requirements[0].links).toBeUndefined()
    })

    it("uses custom label when provided", async () => {
      const { ERC20BalancePredicateClient } = await import(
        "../lib/onchain/predicate-clients.js"
      )
      const client = new ERC20BalancePredicateClient({
        predicateAddress: DUMMY_PREDICATE,
      })
      const access = client.toManifestAccess(CHECKSUMMED_A, MIN_BALANCE, {
        label: "Hold 1000 USDC",
      })

      expect(access.requirements[0].label).toBe("Hold 1000 USDC")
    })
  })
})
