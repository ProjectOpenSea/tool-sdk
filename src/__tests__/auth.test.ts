import { afterEach, describe, expect, it, vi } from "vitest"

// Hardhat/Anvil account #0 — deterministic test key, never holds real funds
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
const BANKR_ADDRESS = "0x8b8e1C20E0630De8C60f0e0D5C3e9C7c20F0c20e"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.PRIVATE_KEY
  delete process.env.RPC_URL
  delete process.env.BANKR_API_KEY
})

describe("auth command", () => {
  it("sends X-Payment on 402 challenge with base64 JSON payload", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []
    let callCount = 0

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })
      callCount++

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            error: "X-PAYMENT header is required",
            accepts: [
              {
                scheme: "exact",
                network: "base",
                maxAmountRequired: "0",
                payTo: "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8",
                asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                extra: { name: "USD Coin", version: "2" },
              },
            ],
          }),
          { status: 402 },
        )
      }

      return new Response(JSON.stringify({ result: "ok" }), { status: 200 })
    })

    vi.stubGlobal("fetch", fetchMock)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { authCommand } = await import("../cli/commands/auth.js")

    await authCommand.parseAsync([
      "node",
      "auth",
      "https://tool.example.com/api",
      "--body",
      '{"query":"test"}',
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)

    // First call: no auth headers
    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(calls[0].headers["X-Payment"]).toBeUndefined()
    expect(calls[0].headers["content-type"]).toBe("application/json")

    // Second call: X-Payment only
    expect(calls[1].headers.Authorization).toBeUndefined()
    expect(calls[1].headers["X-Payment"]).toBeDefined()

    // X-Payment should be valid base64-decodable JSON
    const xPayment = calls[1].headers["X-Payment"]
    const json = Buffer.from(xPayment, "base64").toString("utf-8")
    const payload = JSON.parse(json)
    expect(payload.x402Version).toBe(1)
    expect(payload.scheme).toBe("exact")
    expect(payload.payload.authorization.to).toBe(
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8",
    )

    logSpy.mockRestore()
  })

  it("sends X-Payment when using --wallet-provider flag", async () => {
    let callCount = 0
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })
      callCount++

      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "base",
                maxAmountRequired: "0",
                payTo: "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8",
                asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                extra: { name: "USD Coin", version: "2" },
              },
            ],
          }),
          { status: 402 },
        )
      }

      return new Response(JSON.stringify({ result: "ok" }), { status: 200 })
    })

    vi.stubGlobal("fetch", fetchMock)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { authCommand } = await import("../cli/commands/auth.js")

    await authCommand.parseAsync([
      "node",
      "auth",
      "https://tool.example.com/api",
      "--wallet-provider",
      "private-key",
      "--body",
      "{}",
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)

    expect(calls[0].headers.Authorization).toBeUndefined()
    expect(calls[1].headers["X-Payment"]).toBeDefined()

    logSpy.mockRestore()
  })

  it("prints hint on 401 auth failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({ error: "Predicate gate: invalid SIWE signature" }),
            { status: 401 },
          ),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { authCommand } = await import("../cli/commands/auth.js")

    await authCommand.parseAsync([
      "node",
      "auth",
      "https://tool.example.com/api",
      "--body",
      "{}",
    ])

    const output = logSpy.mock.calls.map(c => c.join(" ")).join("\n")
    expect(output).toContain("Authentication failed")

    logSpy.mockRestore()
  })

  it("prints hint on 403 with predicate address and toolId", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              error: "Predicate gate: access predicate denied",
              toolId: "42",
              predicate: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            }),
            { status: 403 },
          ),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { authCommand } = await import("../cli/commands/auth.js")

    await authCommand.parseAsync([
      "node",
      "auth",
      "https://tool.example.com/api",
      "--body",
      "{}",
    ])

    const output = logSpy.mock.calls.map(c => c.join(" ")).join("\n")
    expect(output).toContain("Access denied")
    expect(output).toContain("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd")
    expect(output).toContain("tool-sdk inspect --tool-id 42")

    logSpy.mockRestore()
  })
})

function stubBankrFetch() {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/wallet/info")) {
      return new Response(JSON.stringify({ address: BANKR_ADDRESS }), {
        status: 200,
      })
    }
    if (typeof url === "string" && url.includes("/wallet/sign")) {
      return new Response(JSON.stringify({ signature: "0xdeadbeef" }), {
        status: 200,
      })
    }
    // Tool endpoint
    const headers = Object.fromEntries(
      Object.entries(init?.headers ?? {}),
    ) as Record<string, string>
    return new Response(JSON.stringify({ result: "ok", headers }), {
      status: 200,
    })
  })
}

describe("auth command with --bankr-key", () => {
  it("uses Bankr signer when BANKR_API_KEY is set", async () => {
    const fetchMock = stubBankrFetch()
    vi.stubGlobal("fetch", fetchMock)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.BANKR_API_KEY = "test-bankr-key"

    const { authCommand } = await import("../cli/commands/auth.js")

    await authCommand.parseAsync([
      "node",
      "auth",
      "https://tool.example.com/api",
      "--body",
      "{}",
    ])

    // Should have called /wallet/info first
    expect(fetchMock.mock.calls[0][0]).toContain("/wallet/info")

    // Should print the Bankr address
    const output = logSpy.mock.calls.map(c => c.join(" ")).join("\n")
    expect(output.toLowerCase()).toContain(BANKR_ADDRESS.toLowerCase())

    logSpy.mockRestore()
  })

  it("prefers Bankr when both PRIVATE_KEY and BANKR_API_KEY are set", async () => {
    const fetchMock = stubBankrFetch()
    vi.stubGlobal("fetch", fetchMock)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"
    process.env.BANKR_API_KEY = "test-bankr-key"

    const { authCommand } = await import("../cli/commands/auth.js")

    await authCommand.parseAsync([
      "node",
      "auth",
      "https://tool.example.com/api",
      "--body",
      "{}",
    ])

    // Bankr path: first call should be /wallet/info
    expect(fetchMock.mock.calls[0][0]).toContain("/wallet/info")

    logSpy.mockRestore()
  })

  it("shows error when no wallet env vars are set", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => {
      throw new Error("process.exit")
    })

    const { authCommand } = await import("../cli/commands/auth.js")

    await expect(
      authCommand.parseAsync([
        "node",
        "auth",
        "https://tool.example.com/api",
        "--body",
        "{}",
      ]),
    ).rejects.toThrow("process.exit")

    const output = errorSpy.mock.calls.map(c => c.join(" ")).join("\n")
    expect(output).toContain("PRIVATE_KEY")
    expect(output).toContain("BANKR_API_KEY")
    expect(exitSpy).toHaveBeenCalledWith(1)
  })
})
