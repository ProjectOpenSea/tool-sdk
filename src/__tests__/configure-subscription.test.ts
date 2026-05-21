import { privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)

const mockConfigureToolGating = vi.fn()
const mockWaitForTransactionReceipt = vi.fn()

vi.mock("../lib/onchain/predicate-clients.js", () => ({
  ERC721OwnerPredicateClient: class {},
  ERC1155OwnerPredicateClient: class {},
  SubscriptionPredicateClient: class {
    configureToolGating = mockConfigureToolGating
  },
}))

vi.mock("../lib/onchain/chains.js", async importOriginal => {
  const actual =
    await importOriginal<typeof import("../lib/onchain/chains.js")>()
  return {
    ...actual,
    deploymentAddress: () => "0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25",
  }
})

vi.mock("../lib/wallet/index.js", () => ({
  createWalletFromEnv: vi.fn(() => ({
    getAddress: async () => "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    signMessage: vi.fn(),
    sendTransaction: vi.fn(),
    name: "private-key",
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

vi.mock("viem", async importOriginal => {
  const actual = await importOriginal<typeof import("viem")>()
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: vi.fn().mockResolvedValue("SubscriptionPredicate"),
      waitForTransactionReceipt: mockWaitForTransactionReceipt,
    }),
  }
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("configure-subscription command", () => {
  it("prints dry-run summary without transacting", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { configureSubscriptionCommand } = await import(
      "../cli/commands/configure-subscription.js"
    )

    await configureSubscriptionCommand.parseAsync([
      "node",
      "configure-subscription",
      "4",
      "0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Configure Subscription")
    expect(output).toContain("Tool ID: 4")
    expect(output).toContain("SubscriptionPredicate")
    expect(output).toContain("0x6C9974CE02dDc6Dc7786F7540613aD2a4f7fF626")
    expect(output).toContain("Min Tier: 0")
    expect(output).toContain("[dry-run]")
    expect(mockConfigureToolGating).not.toHaveBeenCalled()

    logSpy.mockRestore()
  })

  it("accepts --min-tier option", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { configureSubscriptionCommand } = await import(
      "../cli/commands/configure-subscription.js"
    )

    await configureSubscriptionCommand.parseAsync([
      "node",
      "configure-subscription",
      "4",
      "0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626",
      "--min-tier",
      "2",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Min Tier: 2")
    expect(output).toContain("[dry-run]")

    logSpy.mockRestore()
  })

  it("exits with error on invalid collection address", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)

    const { configureSubscriptionCommand } = await import(
      "../cli/commands/configure-subscription.js"
    )

    await configureSubscriptionCommand.parseAsync([
      "node",
      "configure-subscription",
      "4",
      "not-an-address",
      "--dry-run",
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid collection address"),
    )

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it("exits with error when minTier is non-numeric", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)

    const { configureSubscriptionCommand } = await import(
      "../cli/commands/configure-subscription.js"
    )

    await configureSubscriptionCommand.parseAsync([
      "node",
      "configure-subscription",
      "4",
      "0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626",
      "--min-tier",
      "abc",
      "--dry-run",
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "--min-tier must be an integer between 0 and 255",
      ),
    )

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it("exits with error when minTier exceeds 255", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(() => undefined as never)

    const { configureSubscriptionCommand } = await import(
      "../cli/commands/configure-subscription.js"
    )

    await configureSubscriptionCommand.parseAsync([
      "node",
      "configure-subscription",
      "4",
      "0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626",
      "--min-tier",
      "256",
      "--dry-run",
    ])

    expect(exitSpy).toHaveBeenCalledWith(1)
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        "--min-tier must be an integer between 0 and 255",
      ),
    )

    errorSpy.mockRestore()
    exitSpy.mockRestore()
  })

  it("calls configureToolGating and waits for receipt on happy path", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    mockConfigureToolGating.mockResolvedValueOnce("0xdeadbeef")
    mockWaitForTransactionReceipt.mockResolvedValueOnce({})

    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { configureSubscriptionCommand } = await import(
      "../cli/commands/configure-subscription.js"
    )

    await configureSubscriptionCommand.parseAsync([
      "node",
      "configure-subscription",
      "4",
      "0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626",
      "--min-tier",
      "1",
    ])

    expect(mockConfigureToolGating).toHaveBeenCalledWith(
      BigInt(4),
      "0x6C9974CE02dDc6Dc7786F7540613aD2a4f7fF626",
      1,
    )
    expect(mockWaitForTransactionReceipt).toHaveBeenCalledWith({
      hash: "0xdeadbeef",
    })

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Subscription predicate configured!")
    expect(output).toContain("TX Hash: 0xdeadbeef")

    logSpy.mockRestore()
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL
  })
})

describe("register --predicate-config with SubscriptionPredicate", () => {
  const validManifest = {
    type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
    name: "test-tool",
    description: "A test tool",
    endpoint: "https://test.example.com",
    inputs: {},
    outputs: {},
    creatorAddress: TEST_ACCOUNT.address.toLowerCase(),
  }

  class ExitError extends Error {
    code: number
    constructor(code: number) {
      super(`process.exit(${code})`)
      this.code = code
    }
  }

  function mockFetch(manifest: object) {
    return vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(manifest), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    )
  }

  it("validates subscription config: rejects invalid collection address", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code: number,
    ) => {
      throw new ExitError(code)
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const fetchSpy = mockFetch(validManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--access-predicate",
        "0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25",
        "--predicate-config",
        '{"collection":"not-an-address","minTier":0}',
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining(
        'SubscriptionPredicate config requires "collection" address',
      ),
    )

    fetchSpy.mockRestore()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL
  })

  it("validates subscription config: rejects minTier > 255", async () => {
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
      code: number,
    ) => {
      throw new ExitError(code)
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const fetchSpy = mockFetch(validManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await expect(
      registerCommand.parseAsync([
        "node",
        "register",
        "--metadata",
        "https://test.example.com/.well-known/ai-tools/test-tool.json",
        "--access-predicate",
        "0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25",
        "--predicate-config",
        '{"collection":"0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626","minTier":300}',
        "--dry-run",
      ]),
    ).rejects.toThrow(ExitError)

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("minTier must be an integer between 0 and 255"),
    )

    fetchSpy.mockRestore()
    exitSpy.mockRestore()
    errorSpy.mockRestore()
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL
  })

  it("accepts valid subscription config in dry-run", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    process.env.PRIVATE_KEY = TEST_PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const fetchSpy = mockFetch(validManifest)

    const { registerCommand } = await import("../cli/commands/register.js")

    await registerCommand.parseAsync([
      "node",
      "register",
      "--metadata",
      "https://test.example.com/.well-known/ai-tools/test-tool.json",
      "--access-predicate",
      "0xCBe0cd9B1d99d95Baa9c58f2767246C52e461f25",
      "--predicate-config",
      '{"collection":"0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626","minTier":0}',
      "--rpc-url",
      "http://127.0.0.1:1",
      "--dry-run",
    ])

    const output = logSpy.mock.calls.map(c => String(c[0])).join("\n")
    expect(output).toContain("Predicate Config:")
    expect(output).toContain("0x6c9974ce02ddc6dc7786f7540613ad2a4f7ff626")
    expect(output).toContain(
      "Predicate config TX would be sent after registration",
    )
    expect(output).toContain("--dry-run: no transaction sent")

    fetchSpy.mockRestore()
    logSpy.mockRestore()
    delete process.env.PRIVATE_KEY
    delete process.env.RPC_URL
  })
})
