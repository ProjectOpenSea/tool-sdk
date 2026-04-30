import { privateKeyToAccount } from "viem/accounts"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// A deterministic test private key (Hardhat/Anvil account #0, never holds real funds)
const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const TEST_ACCOUNT = privateKeyToAccount(TEST_PRIVATE_KEY)

const validManifest = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
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
