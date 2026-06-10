import { encodeAbiParameters } from "viem"
import { afterEach, describe, expect, it, vi } from "vitest"
import { computeManifestHash } from "../lib/onchain/hash.js"

const VALID_MANIFEST = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
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

const registryCtorConfigs: Record<string, unknown>[] = []

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    constructor(config: Record<string, unknown>) {
      registryCtorConfigs.push(config)
    }
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
  registryCtorConfigs.length = 0
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

  it("threads --rpc-url through to the registry client", async () => {
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
      "--rpc-url",
      "http://localhost:9999",
    ])

    expect(registryCtorConfigs).toHaveLength(1)
    expect(registryCtorConfigs[0].rpcUrl).toBe("http://localhost:9999")

    logSpy.mockRestore()
  })

  it("refuses to fetch a metadata URI that points to a private address", async () => {
    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI:
        "http://169.254.169.254/latest/meta-data/iam/security-credentials/",
      manifestHash: MANIFEST_HASH,
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }))
    vi.stubGlobal("fetch", fetchMock)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit")
    }) as never)

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await expect(
      inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"]),
    ).rejects.toThrow()

    // The link-local metadata address must never be fetched.
    expect(fetchMock).not.toHaveBeenCalled()
    expect(exitSpy).toHaveBeenCalledWith(1)

    logSpy.mockRestore()
    errSpy.mockRestore()
    exitSpy.mockRestore()
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

  it("renders wallet-state-attestation requirement fields when predicate name() is third-party", async () => {
    // Reference impl from douglasborthwick-crypto/insumer-examples returns
    // "InsumerAccessPredicate", not "WalletStateAttestationPredicate" — the
    // renderer must dispatch on the requirement's kind (0x7a111640), not the
    // predicate's name.
    const predicateAddress = "0x1111111111111111111111111111111111111111"
    const issuerJwksUri = "https://issuer.example.com/.well-known/jwks.json"
    const conditionHash =
      "0xabcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890" as const

    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash: MANIFEST_HASH,
      accessPredicate: predicateAddress,
    })

    const data = encodeAbiParameters(
      [{ type: "string" }, { type: "bytes32" }],
      [issuerJwksUri, conditionHash],
    )

    mockReadContract
      .mockResolvedValueOnce("InsumerAccessPredicate")
      .mockResolvedValueOnce([
        [
          {
            kind: "0x7a111640",
            data,
            label: "Cross-chain wallet attestation",
          },
        ],
        0,
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
    expect(output).toContain("Predicate name:   InsumerAccessPredicate")
    expect(output).toContain("Access requirements (AND, advisory):")
    expect(output).toContain("walletStateAttestation")
    expect(output).toContain(`issuerJwksUri:  ${issuerJwksUri}`)
    expect(output).toContain(`conditionHash:  ${conditionHash}`)

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

  it("prints endpoint probe PASS when POST returns 401", async () => {
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify(VALID_MANIFEST), { status: 200 })
        }
        return new Response(null, { status: 401 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Endpoint probe:")
    expect(output).toContain("PASS")

    logSpy.mockRestore()
  })

  it("prints endpoint probe WARN when POST returns 200", async () => {
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
    expect(output).toContain("Endpoint probe:")
    expect(output).toContain("WARN")

    logSpy.mockRestore()
  })

  it("prints endpoint probe FAIL on 405 but does not exit non-zero", async () => {
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify(VALID_MANIFEST), { status: 200 })
        }
        return new Response(null, { status: 405 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { inspectCommand } = await import("../cli/commands/inspect.js")

    await inspectCommand.parseAsync(["node", "inspect", "--tool-id", "1"])

    const allOutput = [
      ...logSpy.mock.calls.map(c => c[0]),
      ...errorSpy.mock.calls.map(c => c[0]),
    ].join("\n")
    expect(allOutput).toContain("Endpoint probe:")
    expect(allOutput).toContain("FAIL")
    expect(allOutput).toContain("405")

    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
