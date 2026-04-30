import { afterEach, describe, expect, it, vi } from "vitest"

// Hardhat/Anvil account #0 — deterministic test key, never holds real funds
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
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
    process.env.TOOL_SDK_PRIVATE_KEY = PRIVATE_KEY

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
    delete process.env.TOOL_SDK_PRIVATE_KEY
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
    process.env.TOOL_SDK_PRIVATE_KEY = PRIVATE_KEY

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
    delete process.env.TOOL_SDK_PRIVATE_KEY
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
    process.env.TOOL_SDK_PRIVATE_KEY = PRIVATE_KEY

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
    delete process.env.TOOL_SDK_PRIVATE_KEY
  })
})
