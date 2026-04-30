import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const VALID_MANIFEST = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
}

// Hardhat/Anvil account #0 — deterministic test key, never holds real funds
const CREATOR_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const CREATOR_ADDRESS = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"

const mockUpdateToolMetadata = vi.fn(async () => "0xtxhash")
const mockGetToolConfig = vi.fn(async () => ({
  creator: CREATOR_ADDRESS,
  metadataURI: "https://old.example.com/manifest.json",
  manifestHash: "0x1234",
  accessPredicate: "0x0000000000000000000000000000000000000000",
}))

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    updateToolMetadata = mockUpdateToolMetadata
    getToolConfig = mockGetToolConfig
  },
}))

vi.mock("@opensea/wallet-adapters/viem", () => ({
  walletAdapterToViemClient: vi.fn(async () => ({})),
}))

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () => new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
    ),
  )
  process.env.PRIVATE_KEY = CREATOR_KEY
  process.env.RPC_URL = "http://localhost:8545"
})

afterEach(() => {
  vi.unstubAllGlobals()
  mockUpdateToolMetadata.mockClear()
  mockGetToolConfig.mockClear()
  delete process.env.PRIVATE_KEY
  delete process.env.RPC_URL
})

describe("update-metadata command", () => {
  it("verifies the caller is the tool creator", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    mockGetToolConfig.mockResolvedValueOnce({
      creator: "0x1111111111111111111111111111111111111111",
      metadataURI: "https://old.example.com/manifest.json",
      manifestHash: "0x1234",
      accessPredicate: "0x0000000000000000000000000000000000000000",
    })

    const { updateMetadataCommand } = await import(
      "../cli/commands/update-metadata.js"
    )

    try {
      await updateMetadataCommand.parseAsync([
        "node",
        "update-metadata",
        "--tool-id",
        "1",
        "--metadata",
        "https://example.com/manifest.json",
        "--yes",
      ])
    } catch {
      // expected process.exit
    }

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("not the tool creator"),
    )
    expect(mockUpdateToolMetadata).not.toHaveBeenCalled()

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("sends the update transaction with correct args", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { updateMetadataCommand } = await import(
      "../cli/commands/update-metadata.js"
    )

    await updateMetadataCommand.parseAsync([
      "node",
      "update-metadata",
      "--tool-id",
      "42",
      "--metadata",
      "https://example.com/manifest.json",
      "--yes",
    ])

    expect(mockUpdateToolMetadata).toHaveBeenCalledWith(
      42n,
      "https://example.com/manifest.json",
      expect.objectContaining({ name: "test-tool" }),
    )

    logSpy.mockRestore()
  })
})
