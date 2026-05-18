import { afterEach, describe, expect, it, vi } from "vitest"

const mockGetCollections = vi.fn()
const mockSetCollections = vi.fn()
const mockSetCollectionTokens = vi.fn()
const mockGetToolConfig = vi.fn()

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    getToolConfig = mockGetToolConfig
  },
}))

vi.mock("../lib/onchain/predicate-clients.js", () => ({
  ERC721OwnerPredicateClient: class {
    getCollections = mockGetCollections
    setCollections = mockSetCollections
  },
  ERC1155OwnerPredicateClient: class {
    setCollectionTokens = mockSetCollectionTokens
  },
}))

vi.mock("../lib/onchain/chains.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../lib/onchain/chains.js")>()
  return {
    ...actual,
    deploymentAddress: () => "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
  }
})

vi.mock("../lib/wallet/index.js", () => ({
  createWalletFromEnv: vi.fn(async () => ({
    getAddress: async () => "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    signMessage: vi.fn(),
    sendTransaction: vi.fn(),
    capabilities: {},
  })),
  createWalletForProvider: vi.fn(),
  walletAdapterToClient: vi.fn(() => ({
    account: {
      address: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    },
    writeContract: vi.fn(),
  })),
  WALLET_PROVIDERS: ["private-key"],
}))

afterEach(() => {
  vi.clearAllMocks()
})

describe("get-collections command", () => {
  it("prints collections for a tool using ERC721OwnerPredicate", async () => {
    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash: "0x1234",
      accessPredicate: "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
    })
    mockGetCollections.mockResolvedValueOnce([
      "0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9",
    ])

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { getCollectionsCommand } = await import(
      "../cli/commands/get-collections.js"
    )

    await getCollectionsCommand.parseAsync(["node", "get-collections", "4"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Collections for tool 4")
    expect(output).toContain("0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9")

    logSpy.mockRestore()
  })

  it("reports open access when predicate is zero address", async () => {
    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      metadataURI: "https://example.com/manifest.json",
      manifestHash: "0x1234",
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { getCollectionsCommand } = await import(
      "../cli/commands/get-collections.js"
    )

    await getCollectionsCommand.parseAsync(["node", "get-collections", "3"])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("open access")

    logSpy.mockRestore()
  })
})

describe("set-collections command", () => {
  it("prints dry-run summary without transacting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { setCollectionsCommand } = await import(
      "../cli/commands/set-collections.js"
    )

    await setCollectionsCommand.parseAsync([
      "node",
      "set-collections",
      "4",
      "0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Set Collections")
    expect(output).toContain("Tool ID: 4")
    expect(output).toContain("ERC721OwnerPredicate")
    expect(output).toContain("0x07152bfde079b5319e5308C43fB1Dbc9C76cb4F9")
    expect(output).toContain("[dry-run]")
    expect(mockSetCollections).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })
})

describe("set-collection-tokens command", () => {
  it("prints dry-run summary without transacting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { setCollectionTokensCommand } = await import(
      "../cli/commands/set-collection-tokens.js"
    )

    await setCollectionTokensCommand.parseAsync([
      "node",
      "set-collection-tokens",
      "4",
      "0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9",
      "1",
      "2",
      "3",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Set Collection Tokens")
    expect(output).toContain("Tool ID: 4")
    expect(output).toContain("ERC1155OwnerPredicate")
    expect(output).toContain("0x07152bfde079b5319e5308C43fB1Dbc9C76cb4F9")
    expect(output).toContain("Token IDs: 1, 2, 3")
    expect(output).toContain("[dry-run]")
    expect(mockSetCollectionTokens).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  it("exits with error on invalid token ID", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)

    const { setCollectionTokensCommand } = await import(
      "../cli/commands/set-collection-tokens.js"
    )

    await setCollectionTokensCommand.parseAsync([
      "node",
      "set-collection-tokens",
      "4",
      "0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9",
      "not-a-number",
      "--dry-run",
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
