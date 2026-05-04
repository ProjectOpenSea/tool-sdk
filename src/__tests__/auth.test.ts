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
  it("sends Authorization: SIWE header with base64url message and signature", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })

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

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const authHeader = calls[0].headers.Authorization
    expect(authHeader).toBeDefined()
    expect(authHeader).toMatch(/^SIWE /)

    const token = authHeader.slice(5)
    const dotIndex = token.lastIndexOf(".")
    expect(dotIndex).toBeGreaterThan(0)

    const messageB64 = token.slice(0, dotIndex)
    const signature = token.slice(dotIndex + 1)

    // Message should be valid base64url-decodable SIWE text
    const message = Buffer.from(messageB64, "base64url").toString("utf-8")
    expect(message).toContain("tool.example.com")
    expect(message).toContain("Authenticate to access this tool")

    // Signature should be a 0x-prefixed hex string
    expect(signature).toMatch(/^0x[0-9a-f]+$/i)

    expect(calls[0].headers["content-type"]).toBe("application/json")

    logSpy.mockRestore()
  })

  it("sends SIWE header when using --wallet-provider flag", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })

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

    expect(fetchMock).toHaveBeenCalledTimes(1)

    const authHeader = calls[0].headers.Authorization
    expect(authHeader).toBeDefined()
    expect(authHeader).toMatch(/^SIWE /)

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
    expect(output).toContain("SIWE authentication failed")

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
