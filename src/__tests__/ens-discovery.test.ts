import { afterEach, describe, expect, it, vi } from "vitest"
import {
  formatCAIP19ToolRef,
  parseCAIP19ToolRef,
} from "../lib/discovery/caip19.js"
import { staticSubnameResolver } from "../lib/discovery/ens.js"

const mockGetToolConfig = vi.fn()

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    getToolConfig = mockGetToolConfig
  },
}))

vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>()
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: vi.fn(),
    }),
  }
})

vi.mock("viem/ens", async importOriginal => {
  const actual = await importOriginal<typeof import("viem/ens")>()
  return {
    ...actual,
    getEnsText: vi.fn(),
  }
})

afterEach(() => {
  vi.restoreAllMocks()
  mockGetToolConfig.mockReset()
})

describe("parseCAIP19ToolRef", () => {
  it("parses a valid CAIP-19 tool reference", () => {
    const ref = parseCAIP19ToolRef(
      "eip155:8453/erc8257:0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1/42",
    )
    expect(ref.chainId).toBe(8453)
    expect(ref.registryAddress).toBe(
      "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1",
    )
    expect(ref.toolId).toBe(42n)
    expect(ref.raw).toBe(
      "eip155:8453/erc8257:0x265BB2DBFC0A8165C9A1941Eb1372F349baD2cf1/42",
    )
  })

  it("parses chain ID 1 (mainnet)", () => {
    const ref = parseCAIP19ToolRef(
      "eip155:1/erc8257:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/1",
    )
    expect(ref.chainId).toBe(1)
    expect(ref.toolId).toBe(1n)
  })

  it("throws on invalid format — missing namespace", () => {
    expect(() => parseCAIP19ToolRef("8453/erc8257:0xabc/1")).toThrow(
      "Invalid CAIP-19 tool reference",
    )
  })

  it("throws on invalid format — bad address", () => {
    expect(() => parseCAIP19ToolRef("eip155:8453/erc8257:0xZZZ/1")).toThrow(
      "Invalid CAIP-19 tool reference",
    )
  })

  it("throws on invalid format — missing tool ID", () => {
    expect(() =>
      parseCAIP19ToolRef(
        "eip155:8453/erc8257:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      ),
    ).toThrow("Invalid CAIP-19 tool reference")
  })

  it("throws on empty string", () => {
    expect(() => parseCAIP19ToolRef("")).toThrow(
      "Invalid CAIP-19 tool reference",
    )
  })
})

describe("formatCAIP19ToolRef", () => {
  it("formats a tool ref to canonical string", () => {
    const result = formatCAIP19ToolRef({
      raw: "eip155:8453/erc8257:0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1/42",
      chainId: 8453,
      registryAddress: "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1",
      toolId: 42n,
    })
    expect(result).toBe(
      "eip155:8453/erc8257:0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1/42",
    )
  })
})

describe("staticSubnameResolver", () => {
  it("returns the provided subnames", async () => {
    const resolver = staticSubnameResolver([
      "web.example.eth",
      "api.example.eth",
    ])
    const result = await resolver.resolveSubnames("example.eth")
    expect(result).toEqual(["web.example.eth", "api.example.eth"])
  })
})

describe("discoverToolsFromENS", () => {
  it("discovers tools from ENS subnames with registrations", async () => {
    const { getEnsText } = await import("viem/ens")
    const mockedGetEnsText = vi.mocked(getEnsText)

    mockedGetEnsText.mockImplementation(async (_client, params) => {
      const key = params.key
      if (params.name === "web.example.eth") {
        if (key === "registrations[0]") {
          return "eip155:8453/erc8257:0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1/1"
        }
        if (key === "registrations[1]") return null
        if (
          key ===
          "attestations[eip155:8453/erc8257:0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1/1]"
        ) {
          return "https://tools.example.com/.well-known/ens-attestation"
        }
      }
      return null
    })

    mockGetToolConfig.mockResolvedValue({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://tools.example.com/manifest.json",
      manifestHash: "0xdeadbeef",
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url === "https://tools.example.com/manifest.json") {
          return new Response(
            JSON.stringify({ endpoint: "https://tools.example.com/api/v1" }),
            { status: 200 },
          )
        }
        return new Response("", { status: 404 })
      }),
    )

    const { discoverToolsFromENS } = await import("../lib/discovery/ens.js")

    const result = await discoverToolsFromENS({
      ensName: "example.eth",
      subnameResolver: staticSubnameResolver(["web.example.eth"]),
    })

    expect(result.ensName).toBe("example.eth")
    expect(result.applications).toHaveLength(1)
    expect(result.applications[0].name).toBe("web.example.eth")
    expect(result.applications[0].registrations).toHaveLength(1)
    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].caip19.toolId).toBe(1n)
    expect(result.tools[0].originVerification.toolOrigin).toBe(
      "https://tools.example.com",
    )
    expect(result.tools[0].originVerification.ensAttestationOrigin).toBe(
      "https://tools.example.com",
    )
    expect(result.tools[0].originVerification.verified).toBe(true)
  })

  it("reports verification failure when origins do not match", async () => {
    const { getEnsText } = await import("viem/ens")
    const mockedGetEnsText = vi.mocked(getEnsText)

    mockedGetEnsText.mockImplementation(async (_client, params) => {
      const key = params.key
      if (params.name === "app.example.eth") {
        if (key === "registrations[0]") {
          return "eip155:1/erc8257:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/5"
        }
        if (key === "registrations[1]") return null
        if (
          key ===
          "attestations[eip155:1/erc8257:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd/5]"
        ) {
          return "https://malicious.com/.well-known/ens-attestation"
        }
      }
      return null
    })

    mockGetToolConfig.mockResolvedValue({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://real-app.example.com/manifest.json",
      manifestHash: "0xdeadbeef",
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              endpoint: "https://real-app.example.com/tools/v1",
            }),
            { status: 200 },
          ),
      ),
    )

    const { discoverToolsFromENS } = await import("../lib/discovery/ens.js")

    const result = await discoverToolsFromENS({
      ensName: "example.eth",
      subnameResolver: staticSubnameResolver(["app.example.eth"]),
    })

    expect(result.tools).toHaveLength(1)
    expect(result.tools[0].originVerification.verified).toBe(false)
    expect(result.tools[0].originVerification.toolOrigin).toBe(
      "https://real-app.example.com",
    )
    expect(result.tools[0].originVerification.ensAttestationOrigin).toBe(
      "https://malicious.com",
    )
  })

  it("handles subnames with no registrations gracefully", async () => {
    const { getEnsText } = await import("viem/ens")
    const mockedGetEnsText = vi.mocked(getEnsText)
    mockedGetEnsText.mockResolvedValue(null)

    const { discoverToolsFromENS } = await import("../lib/discovery/ens.js")

    const result = await discoverToolsFromENS({
      ensName: "empty.eth",
      subnameResolver: staticSubnameResolver(["sub.empty.eth"]),
    })

    expect(result.applications).toHaveLength(0)
    expect(result.tools).toHaveLength(0)
    expect(result.errors).toHaveLength(0)
  })

  it("collects errors without failing the entire traversal", async () => {
    const { getEnsText } = await import("viem/ens")
    const mockedGetEnsText = vi.mocked(getEnsText)

    mockedGetEnsText.mockImplementation(async (_client, params) => {
      if (params.name === "broken.example.eth") {
        throw new Error("resolver not found")
      }
      if (params.name === "ok.example.eth") {
        if (params.key === "registrations[0]") {
          return "eip155:8453/erc8257:0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1/99"
        }
        if (params.key === "registrations[1]") return null
        return null
      }
      return null
    })

    mockGetToolConfig.mockResolvedValue({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://ok.example.com/manifest.json",
      manifestHash: "0xdeadbeef",
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ endpoint: "https://ok.example.com/api" }),
            { status: 200 },
          ),
      ),
    )

    const { discoverToolsFromENS } = await import("../lib/discovery/ens.js")

    const result = await discoverToolsFromENS({
      ensName: "example.eth",
      subnameResolver: staticSubnameResolver([
        "broken.example.eth",
        "ok.example.eth",
      ]),
    })

    expect(result.errors.length).toBeGreaterThan(0)
    expect(result.errors[0].phase).toBe("schema-read")
    expect(result.tools).toHaveLength(1)
  })
})
