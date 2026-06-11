import { privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A deterministic test private key (Hardhat/Anvil account #0, never holds real funds)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)

const validManifest = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: TEST_ACCOUNT.address.toLowerCase(),
}

const mismatchedManifest = {
  ...validManifest,
  creatorAddress: "0x0000000000000000000000000000000000000001",
}

class ExitError extends Error {
  code: number
  constructor(code: number) {
    super(`process.exit(${code})`)
    this.code = code
  }
}

const registryCtorConfigs: Record<string, unknown>[] = []
const mockRegisterTool = vi.fn(async () => ({
  toolId: 7n,
  txHash: "0xtxhash",
}))

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    constructor(config: Record<string, unknown>) {
      registryCtorConfigs.push(config)
    }
    registerTool = mockRegisterTool
  },
}))

vi.mock("@opensea/wallet-adapters/viem", () => ({
  walletAdapterToViemClient: vi.fn(async () => ({})),
}))

function mockFetch(manifest: object) {
  return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(manifest), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  )
}

describe("register creatorAddress validation", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- process.exit returns `never`, which clashes with vi.spyOn's generic
  let exitSpy: any
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  const originalPrivateKey = process.env.PRIVATE_KEY
  const originalRpcUrl = process.env.RPC_URL

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new ExitError(code)
    }) as never)
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
    registryCtorConfigs.length = 0
    mockRegisterTool.mockClear()
    if (originalPrivateKey !== undefined) {
      process.env.PRIVATE_KEY = originalPrivateKey
    } else {
      delete process.env.PRIVATE_KEY
    }
    if (originalRpcUrl !== undefined) {
      process.env.RPC_URL = originalRpcUrl
    } else {
      delete process.env.RPC_URL
    }
  })

  it("should exit when no wallet provider is configured", async () => {
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL
    delete process.env.PRIVY_APP_ID
    delete process.env.PRIVY_APP_SECRET
    delete process.env.FIREBLOCKS_API_KEY
    delete process.env.TURNKEY_API_PUBLIC_KEY
    const fetchSpy = mockFetch(validManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--dry-run",
      ]),
    ).rejects.toThrow("No wallet provider configured")

    fetchSpy.mockRestore()
  })

  it("should exit when creatorAddress does not match wallet", async () => {
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"
    const fetchSpy = mockFetch(mismatchedManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("does not match your wallet"),
    )

    fetchSpy.mockRestore()
  })

  it("should exit when creatorAddress uses checksummed (mixed-case) hex", async () => {
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"
    const checksummedManifest = {
      ...validManifest,
      creatorAddress: TEST_ACCOUNT.address,
    }
    const fetchSpy = mockFetch(checksummedManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Manifest validation failed"),
    )

    fetchSpy.mockRestore()
  })

  it("should proceed when creatorAddress matches wallet", async () => {
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"
    const fetchSpy = mockFetch(validManifest)

    const { registerCommand } = await import("../cli/commands/register.js")
    await registerCommand.parseAsync([
      "node",
      "register",
      "--metadata",
      "https://test.example.com/.well-known/ai-tools/test-tool.json",
      "--dry-run",
    ])

    const creatorErrorCalls = errorSpy.mock.calls.filter(call =>
      String(call[0]).includes("does not match your wallet"),
    )
    expect(creatorErrorCalls).toHaveLength(0)

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("Registration summary"),
    )

    fetchSpy.mockRestore()
  })
})

describe("register --access-predicate + --predicate-config (F4d)", () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- process.exit returns `never`
  let exitSpy: any
  let errorSpy: ReturnType<typeof vi.spyOn>
  let logSpy: ReturnType<typeof vi.spyOn>
  const originalPrivateKey = process.env.PRIVATE_KEY
  const originalRpcUrl = process.env.RPC_URL

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation(((code: number) => {
      throw new ExitError(code)
    }) as never)
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"
  })

  afterEach(() => {
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    logSpy.mockRestore()
    registryCtorConfigs.length = 0
    mockRegisterTool.mockClear()
    if (originalPrivateKey !== undefined) {
      process.env.PRIVATE_KEY = originalPrivateKey
    } else {
      delete process.env.PRIVATE_KEY
    }
    if (originalRpcUrl !== undefined) {
      process.env.RPC_URL = originalRpcUrl
    } else {
      delete process.env.RPC_URL
    }
  })

  it("rejects --predicate-config without --access-predicate", async () => {
    const fetchSpy = mockFetch(validManifest)
    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--predicate-config",
        '{"collections":["0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9"]}',
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--predicate-config requires --access-predicate"),
    )

    fetchSpy.mockRestore()
  })

  it("rejects invalid JSON in --predicate-config", async () => {
    const fetchSpy = mockFetch(validManifest)
    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--access-predicate",
        "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
        "--predicate-config",
        "not-json",
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("--predicate-config is not valid JSON"),
    )

    fetchSpy.mockRestore()
  })

  it("rejects invalid --access-predicate address", async () => {
    const fetchSpy = mockFetch(validManifest)
    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--access-predicate",
        "not-an-address",
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("is not a valid address"),
    )

    fetchSpy.mockRestore()
  })

  it("prints warning when --access-predicate used without --predicate-config", async () => {
    const fetchSpy = mockFetch(validManifest)
    const { registerCommand } = await import("../cli/commands/register.js")

    await registerCommand.parseAsync([
      "node",
      "register",
      "--metadata",
      "https://test.example.com/.well-known/ai-tools/test-tool.json",
      "--access-predicate",
      "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
      "--rpc-url",
      "http://127.0.0.1:1",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n")
    expect(output).toContain("WARNING: predicate")
    expect(output).toContain("registered but not configured")
    expect(output).toContain("--dry-run: no transaction sent")

    fetchSpy.mockRestore()
  })

  it("shows predicate config in dry-run summary", async () => {
    const fetchSpy = mockFetch(validManifest)
    const { registerCommand } = await import("../cli/commands/register.js")

    await registerCommand.parseAsync([
      "node",
      "register",
      "--metadata",
      "https://test.example.com/.well-known/ai-tools/test-tool.json",
      "--access-predicate",
      "0x4eC929dcc11B8B3a7d32CD9360BE7B8C73077b88",
      "--predicate-config",
      '{"collections":["0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9"]}',
      "--rpc-url",
      "http://127.0.0.1:1",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n")
    expect(output).toContain("Predicate Config:")
    expect(output).toContain("0x07152bfde079b5319e5308c43fb1dbc9c76cb4f9")
    expect(output).toContain(
      "Predicate config TX would be sent after registration",
    )
    expect(output).toContain("--dry-run: no transaction sent")

    fetchSpy.mockRestore()
  })

  it("threads --rpc-url through to the registry client", async () => {
    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"
    const fetchSpy = mockFetch(validManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await registerCommand.parseAsync([
      "node",
      "register",
      "--metadata",
      "https://test.example.com/.well-known/ai-tools/test-tool.json",
      "--rpc-url",
      "http://localhost:9999",
      "--yes",
    ])

    expect(mockRegisterTool).toHaveBeenCalled()
    // The registry client waits for the tx receipt on its internal public
    // client, so it must use the explicit RPC, never viem's chain default.
    expect(registryCtorConfigs).toHaveLength(1)
    expect(registryCtorConfigs[0].rpcUrl).toBe("http://localhost:9999")

    fetchSpy.mockRestore()
  })
})
