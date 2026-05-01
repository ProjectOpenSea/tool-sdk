import type { Address, Hex } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"

const mockGetBlockNumber = vi.fn<() => Promise<bigint>>()
const mockGetLogs = vi.fn()

vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>()
  return {
    ...actual,
    createPublicClient: () => ({
      getBlockNumber: mockGetBlockNumber,
      getLogs: mockGetLogs,
      readContract: vi.fn(),
    }),
  }
})

afterEach(() => {
  mockGetBlockNumber.mockReset()
  mockGetLogs.mockReset()
})

describe("listToolsByCreator", () => {
  const creator: Address = "0xAbCdEf0123456789AbCdEf0123456789AbCdEf00"

  it("returns parsed tools from event logs", async () => {
    mockGetBlockNumber.mockResolvedValue(20_000n)
    mockGetLogs.mockResolvedValue([
      {
        args: {
          toolId: 1n,
          creator,
          accessPredicate: "0x0000000000000000000000000000000000000000",
          metadataURI: "https://example.com/tool1.json",
          manifestHash:
            "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as Hex,
        },
        transactionHash:
          "0x1111111111111111111111111111111111111111111111111111111111111111",
        blockNumber: 19_500n,
      },
      {
        args: {
          toolId: 5n,
          creator,
          accessPredicate: "0x2222222222222222222222222222222222222222",
          metadataURI: "https://example.com/tool5.json",
          manifestHash:
            "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" as Hex,
        },
        transactionHash:
          "0x3333333333333333333333333333333333333333333333333333333333333333",
        blockNumber: 19_800n,
      },
    ])

    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const client = new ToolRegistryClient({ rpcUrl: "http://localhost:8545" })
    const tools = await client.listToolsByCreator(creator)

    expect(tools).toHaveLength(2)
    expect(tools[0]).toEqual({
      toolId: 1n,
      accessPredicate: "0x0000000000000000000000000000000000000000",
      metadataURI: "https://example.com/tool1.json",
      manifestHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      txHash:
        "0x1111111111111111111111111111111111111111111111111111111111111111",
      blockNumber: 19_500n,
    })
    expect(tools[1]).toEqual({
      toolId: 5n,
      accessPredicate: "0x2222222222222222222222222222222222222222",
      metadataURI: "https://example.com/tool5.json",
      manifestHash:
        "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      txHash:
        "0x3333333333333333333333333333333333333333333333333333333333333333",
      blockNumber: 19_800n,
    })
  })

  it("defaults fromBlock to latestBlock - 10_000", async () => {
    mockGetBlockNumber.mockResolvedValue(50_000n)
    mockGetLogs.mockResolvedValue([])

    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const client = new ToolRegistryClient({ rpcUrl: "http://localhost:8545" })
    await client.listToolsByCreator(creator)

    expect(mockGetLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 40_000n,
        toBlock: "latest",
        args: { creator },
      }),
    )
  })

  it("uses explicit fromBlock and toBlock when provided", async () => {
    mockGetBlockNumber.mockResolvedValue(50_000n)
    mockGetLogs.mockResolvedValue([])

    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const client = new ToolRegistryClient({ rpcUrl: "http://localhost:8545" })
    await client.listToolsByCreator(creator, {
      fromBlock: 100n,
      toBlock: 200n,
    })

    expect(mockGetLogs).toHaveBeenCalledWith(
      expect.objectContaining({
        fromBlock: 100n,
        toBlock: 200n,
        args: { creator },
      }),
    )
  })

  it("returns empty array when no tools found", async () => {
    mockGetBlockNumber.mockResolvedValue(20_000n)
    mockGetLogs.mockResolvedValue([])

    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const client = new ToolRegistryClient({ rpcUrl: "http://localhost:8545" })
    const tools = await client.listToolsByCreator(creator)

    expect(tools).toEqual([])
  })

  it("skips getBlockNumber when fromBlock is provided", async () => {
    mockGetLogs.mockResolvedValue([])

    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const client = new ToolRegistryClient({ rpcUrl: "http://localhost:8545" })
    await client.listToolsByCreator(creator, { fromBlock: 100n })

    expect(mockGetBlockNumber).not.toHaveBeenCalled()
  })
})
