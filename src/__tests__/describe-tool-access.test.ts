import { encodeAbiParameters, getAddress } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"

const TEST_TOOL_ID = 7n
const PREDICATE_ADDRESS = getAddress(
  "0x1111111111111111111111111111111111111111",
)
const COLLECTION = getAddress("0xaAaAaAaaAaAaAaaAaAAAAAAAAaaaAaAaAaaAaaAa")

const mockGetToolConfig = vi.fn(async () => ({
  creator: getAddress("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd"),
  metadataURI: "https://example.com/manifest.json",
  manifestHash:
    "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
  accessPredicate: PREDICATE_ADDRESS,
}))

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    getToolConfig = mockGetToolConfig
  },
}))

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

afterEach(() => {
  mockGetToolConfig.mockClear()
  mockReadContract.mockReset()
})

// A well-formed ERC-721 requirement, used as the "good" baseline.
const goodRequirement = {
  kind: "0xbdf8c428" as `0x${string}`,
  data: encodeAbiParameters([{ type: "address" }], [COLLECTION]),
  label: "Hold an NFT",
}

function routeReadContract(routes: {
  name?: string
  requirements: readonly {
    kind: `0x${string}`
    data: `0x${string}`
    label: string
  }[]
  logic?: 0 | 1
}) {
  mockReadContract.mockImplementation((args: { functionName: string }) => {
    if (args.functionName === "name") {
      return Promise.resolve(routes.name ?? "MockPredicate")
    }
    if (args.functionName === "getRequirements") {
      return Promise.resolve([routes.requirements, routes.logic ?? 0])
    }
    throw new Error(`unexpected readContract call: ${args.functionName}`)
  })
}

describe("describeToolAccess bounds enforcement", () => {
  it("passes well-formed name and requirements through unchanged", async () => {
    routeReadContract({ name: "MyPredicate", requirements: [goodRequirement] })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.predicateName).toBe("MyPredicate")
    expect(result.requirements).toEqual([goodRequirement])
    expect(result.logic).toBe("AND")
  })

  it("treats over-cap name() (>256 UTF-8 bytes) as if not implemented", async () => {
    routeReadContract({
      name: "A".repeat(257),
      requirements: [goodRequirement],
    })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.predicateName).toBeNull()
    expect(result.requirements).toEqual([goodRequirement])
  })

  it("returns empty requirements when length exceeds 256 entries", async () => {
    const oversized = Array.from({ length: 257 }, () => goodRequirement)
    routeReadContract({ requirements: oversized })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.requirements).toEqual([])
  })

  it("accepts exactly 256 entries", async () => {
    const atCap = Array.from({ length: 256 }, () => goodRequirement)
    routeReadContract({ requirements: atCap })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.requirements).toHaveLength(256)
  })

  it("substitutes the kind sentinel for entries whose data exceeds 4096 bytes", async () => {
    const oversizedData = `0x${"ab".repeat(4097)}` as `0x${string}`
    routeReadContract({
      requirements: [
        goodRequirement,
        { kind: "0xdeadbeef", data: oversizedData, label: "oversize-data" },
        goodRequirement,
      ],
    })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.requirements).toEqual([
      goodRequirement,
      { kind: "0x00000000", data: "0x", label: "" },
      goodRequirement,
    ])
  })

  it("substitutes the kind sentinel for entries whose label exceeds 256 UTF-8 bytes", async () => {
    routeReadContract({
      requirements: [
        {
          kind: goodRequirement.kind,
          data: goodRequirement.data,
          label: "L".repeat(257),
        },
      ],
    })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.requirements).toEqual([
      { kind: "0x00000000", data: "0x", label: "" },
    ])
  })

  it("substitutes the sentinel for multibyte-UTF-8 labels that decode over 256 bytes", async () => {
    // Each "🦄" is 4 UTF-8 bytes; 65 of them = 260 bytes (over cap) but only
    // 130 JS code units (under a naïve .length check).
    const multibyteLabel = "🦄".repeat(65)
    routeReadContract({
      requirements: [
        {
          kind: goodRequirement.kind,
          data: goodRequirement.data,
          label: multibyteLabel,
        },
      ],
    })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.requirements).toEqual([
      { kind: "0x00000000", data: "0x", label: "" },
    ])
  })

  it("accepts entries exactly at the data and label caps", async () => {
    const dataAtCap = `0x${"00".repeat(4096)}` as `0x${string}`
    const labelAtCap = "x".repeat(256)
    routeReadContract({
      requirements: [
        { kind: goodRequirement.kind, data: dataAtCap, label: labelAtCap },
      ],
    })
    const { describeToolAccess } = await import("../lib/onchain/access.js")

    const result = await describeToolAccess({ toolId: TEST_TOOL_ID })

    expect(result.requirements).toEqual([
      { kind: goodRequirement.kind, data: dataAtCap, label: labelAtCap },
    ])
  })
})
