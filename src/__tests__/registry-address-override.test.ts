import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi.fn(),
    })),
  }
})

describe("ToolRegistryClient registryAddress override", () => {
  beforeEach(async () => {
    const { createPublicClient } = await import("viem")
    vi.mocked(createPublicClient).mockClear()
  })

  it("uses the provided registryAddress instead of the canonical deployment", async () => {
    const customAddress =
      "0x1111111111111111111111111111111111111111" as `0x${string}`
    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const client = new ToolRegistryClient({ registryAddress: customAddress })

    const { createPublicClient } = await import("viem")
    const mockPublic = vi.mocked(createPublicClient).mock.results[0]?.value as {
      readContract: ReturnType<typeof vi.fn>
    }
    mockPublic.readContract.mockResolvedValueOnce(0n)

    await client.toolCount()

    expect(mockPublic.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: customAddress }),
    )
  })

  it("falls back to canonical deployment address when registryAddress is not provided", async () => {
    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")
    const { TOOL_REGISTRY, deploymentAddress } = await import(
      "../lib/onchain/chains.js"
    )
    const { base } = await import("viem/chains")
    const expectedAddress = deploymentAddress(TOOL_REGISTRY, base.id)

    const client = new ToolRegistryClient({})

    const { createPublicClient } = await import("viem")
    const mockPublic = vi.mocked(createPublicClient).mock.results[0]?.value as {
      readContract: ReturnType<typeof vi.fn>
    }
    mockPublic.readContract.mockResolvedValueOnce(0n)

    await client.toolCount()

    expect(mockPublic.readContract).toHaveBeenCalledWith(
      expect.objectContaining({ address: expectedAddress }),
    )
  })

  it("skips the deployment lookup error when registryAddress is provided for an unsupported chain", async () => {
    const customAddress =
      "0x2222222222222222222222222222222222222222" as `0x${string}`
    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")

    // Chain 999999 is not in TOOL_REGISTRY.chains — without override this
    // would throw.
    expect(
      () =>
        new ToolRegistryClient({
          chain: { id: 999999, name: "unsupported" } as never,
          registryAddress: customAddress,
        }),
    ).not.toThrow()
  })

  it("throws when registryAddress is not provided for an unsupported chain", async () => {
    const { ToolRegistryClient } = await import("../lib/onchain/registry.js")

    expect(
      () =>
        new ToolRegistryClient({
          chain: { id: 999999, name: "unsupported" } as never,
        }),
    ).toThrow(/not deployed on chain 999999/i)
  })
})
