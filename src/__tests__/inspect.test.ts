import { afterEach, describe, expect, it, vi } from "vitest"
import { computeManifestHash } from "../lib/onchain/hash.js"

const VALID_MANIFEST = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
}

const MANIFEST_HASH = computeManifestHash(VALID_MANIFEST)

const mockGetToolConfig = vi.fn(async () => ({
  creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  metadataURI: "https://example.com/manifest.json",
  manifestHash: MANIFEST_HASH,
  accessPredicate: "0x0000000000000000000000000000000000000000",
}))

const mockTryHasAccess = vi.fn(async () => ({ ok: true, granted: true }))

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    getToolConfig = mockGetToolConfig
    tryHasAccess = mockTryHasAccess
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
  vi.unstubAllGlobals()
  mockGetToolConfig.mockClear()
  mockTryHasAccess.mockClear()
  mockReadContract.mockReset()
})

describe("inspect command", () => {
  it("prints onchain config and cross-checks manifest hash", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Creator:")
    expect(output).toContain("Metadata URI:")
    expect(output).toContain("Manifest Hash:")
    expect(output).toContain("PASS")
    expect(output).toContain("MATCH")

    logSpy.mockRestore()
  })

  it("reports MISMATCH when computed hash differs from onchain hash", async () => {
    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash:
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    try {
      await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("MISMATCH")

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("shows predicate name and ERC-721 collections for non-zero predicate", async () => {
    const predicateAddress = "0x1111111111111111111111111111111111111111"
    const collectionA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const collectionB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash: MANIFEST_HASH,
      accessPredicate: predicateAddress,
    })

    mockReadContract
      .mockResolvedValueOnce("ERC721OwnerPredicate")
      .mockResolvedValueOnce([collectionA, collectionB])

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Predicate name:   ERC721OwnerPredicate")
    expect(output).toContain("Collections:")
    expect(output).toContain(`[0] ${collectionA}`)
    expect(output).toContain(`[1] ${collectionB}`)

    logSpy.mockRestore()
  })

  it("shows predicate name and ERC-1155 collection tokens for non-zero predicate", async () => {
    const predicateAddress = "0x1111111111111111111111111111111111111111"
    const collectionA = "0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"
    const collectionB = "0xBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"

    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash: MANIFEST_HASH,
      accessPredicate: predicateAddress,
    })

    mockReadContract
      .mockResolvedValueOnce("ERC1155OwnerPredicate")
      .mockResolvedValueOnce([
        { collection: collectionA, tokenIds: [1n, 2n] },
        { collection: collectionB, tokenIds: [42n] },
      ])

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Predicate name:   ERC1155OwnerPredicate")
    expect(output).toContain("Collection tokens:")
    expect(output).toContain(`[0] ${collectionA}`)
    expect(output).toContain("Token IDs: 1, 2")
    expect(output).toContain(`[1] ${collectionB}`)
    expect(output).toContain("Token IDs: 42")

    logSpy.mockRestore()
  })

  it("shows <unknown> when predicate name() call fails", async () => {
    const predicateAddress = "0x1111111111111111111111111111111111111111"

    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash: MANIFEST_HASH,
      accessPredicate: predicateAddress,
    })

    mockReadContract.mockRejectedValueOnce(new Error("not implemented"))

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Predicate name:   <unknown>")

    logSpy.mockRestore()
  })

  it("prints tryHasAccess result when --check-access is provided", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })

    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync([
      "node",
      "inspect",
      "--tool-id",
      "1",
      "--check-access",
      "0x1234567890abcdef1234567890abcdef12345678",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Access check for")
    expect(output).toContain("ok: true (predicate responded normally)")
    expect(output).toContain("granted: true")

    logSpy.mockRestore()
  })

  it("exits with error for invalid --check-access address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    try {
      await inspectCommand.parseAsync([
        "node",
        "inspect",
        "--tool-id",
        "1",
        "--check-access",
        "foobar",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain(
      "--check-access must be a valid Ethereum address",
    )

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
