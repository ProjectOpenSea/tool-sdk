import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  getAccountUsername,
  getCollectionHolders,
  getCollectionMeta,
  getTokenHolders,
  getTokenMeta,
  OpenSeaError,
  setOpenseaApiKey,
} from "../opensea.js"

const fetchMock = vi.fn()
vi.stubGlobal("fetch", fetchMock)

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  }
}

beforeEach(() => {
  setOpenseaApiKey("test-key")
  fetchMock.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("getTokenHolders", () => {
  it("returns mapped holders from a single page", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        holders: [
          { owner_address: "0xAAA", quantity: 100, usd_value: 500 },
          { owner_address: "0xBBB", quantity: 50 },
        ],
      }),
    )

    const holders = await getTokenHolders("ethereum", "0xToken", 1)
    expect(holders).toEqual([
      { address: "0xaaa", quantity: 100, usdValue: 500 },
      { address: "0xbbb", quantity: 50, usdValue: 0 },
    ])
  })

  it("coerces string quantity and usd_value to numbers", async () => {
    // The live endpoint returns these as strings (amounts can exceed
    // JS-safe integers); the output schema requires numbers.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        holders: [
          {
            owner_address: "0xAAA",
            quantity: "108150806411354.1",
            usd_value: "11455462.55186237",
          },
        ],
      }),
    )

    const holders = await getTokenHolders("ethereum", "0xToken", 1)
    expect(holders).toEqual([
      {
        address: "0xaaa",
        quantity: 108150806411354.1,
        usdValue: 11455462.55186237,
      },
    ])
    expect(typeof holders[0].quantity).toBe("number")
    expect(typeof holders[0].usdValue).toBe("number")
  })

  it("paginates across multiple pages", async () => {
    const page1Holders = Array.from({ length: 100 }, (_, i) => ({
      owner_address: `0x${String(i).padStart(40, "0")}`,
      quantity: 1,
    }))
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ holders: page1Holders, next: "cursor2" }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          holders: [{ owner_address: "0xLAST", quantity: 1 }],
        }),
      )

    const holders = await getTokenHolders("ethereum", "0xToken", 2)
    expect(holders).toHaveLength(101)
    expect(holders[100].address).toBe("0xlast")
  })

  it("continues paginating when page is partial but cursor exists", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          holders: [{ owner_address: "0xAAA", quantity: 1 }],
          next: "cursor2",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          holders: [{ owner_address: "0xBBB", quantity: 2 }],
        }),
      )

    const holders = await getTokenHolders("ethereum", "0xToken", 5)
    expect(holders).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("stops when maxPages is reached", async () => {
    const fullPage = Array.from({ length: 100 }, (_, i) => ({
      owner_address: `0x${String(i).padStart(40, "0")}`,
      quantity: 1,
    }))
    fetchMock.mockResolvedValue(
      jsonResponse({ holders: fullPage, next: "cursor" }),
    )

    const holders = await getTokenHolders("ethereum", "0xToken", 1)
    expect(holders).toHaveLength(100)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})

describe("getCollectionHolders", () => {
  it("returns mapped holders", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        holders: [
          { address: "0xAAA", quantity: 3, percentage: 1.5 },
          { address: "0xBBB", quantity: 1, percentage: 0.5 },
        ],
      }),
    )

    const holders = await getCollectionHolders("bayc", 1)
    expect(holders).toEqual([
      { address: "0xaaa", quantity: 3, ownershipPct: 1.5 },
      { address: "0xbbb", quantity: 1, ownershipPct: 0.5 },
    ])
  })
})

describe("getCollectionMeta", () => {
  it("fetches collection info and stats in parallel", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "Cool Cats" }))
      .mockResolvedValueOnce(jsonResponse({ total: { floor_price: 2.5 } }))

    const meta = await getCollectionMeta("cool-cats")
    expect(meta).toEqual({ name: "Cool Cats", floorPriceEth: 2.5 })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("returns null floorPriceEth when stats fail", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ name: "Cool Cats" }))
      .mockResolvedValueOnce(jsonResponse({}, 500))

    const meta = await getCollectionMeta("cool-cats")
    expect(meta.name).toBe("Cool Cats")
    expect(meta.floorPriceEth).toBeNull()
  })
})

describe("getTokenMeta", () => {
  it("returns token name and symbol", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ name: "USD Coin", symbol: "USDC" }),
    )
    const meta = await getTokenMeta("ethereum", "0xToken")
    expect(meta).toEqual({ name: "USD Coin", symbol: "USDC" })
  })

  it("falls back to defaults for missing fields", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const meta = await getTokenMeta("ethereum", "0xToken")
    expect(meta).toEqual({ name: "Unknown", symbol: "???" })
  })
})

describe("getAccountUsername", () => {
  it("returns username when present", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ username: "alice" }))
    const username = await getAccountUsername("0xAddr")
    expect(username).toBe("alice")
  })

  it("returns null when username is missing", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({}))
    const username = await getAccountUsername("0xAddr")
    expect(username).toBeNull()
  })

  it("returns null on API failure", async () => {
    fetchMock.mockRejectedValueOnce(new Error("network"))
    const username = await getAccountUsername("0xAddr")
    expect(username).toBeNull()
  })
})

describe("OpenSeaError", () => {
  it("throws OpenSeaError on non-OK response", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: "not found" }, 404))
    await expect(getTokenMeta("ethereum", "0xBad")).rejects.toThrow(
      OpenSeaError,
    )
  })
})
