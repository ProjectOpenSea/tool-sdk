import { generatePrivateKey } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"

const TEST_KEY = generatePrivateKey()

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: vi.fn().mockResolvedValue(1n),
      verifySiweMessage: vi.fn().mockResolvedValue(true),
    }),
  }
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("smoke command", () => {
  it("exits 0 when status matches --expect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
      "--as",
      TEST_KEY,
      "--input",
      "{}",
      "--expect",
      "200",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("PASS")
    expect(output).toContain("200")

    logSpy.mockRestore()
  })

  it("exits 1 when status does not match --expect", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
      ),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--tool-id",
        "2",
        "--endpoint",
        "https://example.com/api/invoke",
        "--as",
        TEST_KEY,
        "--expect",
        "200",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("FAIL")
    expect(errorOutput).toContain("Expected status 200, got 403")

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("exits 0 when expecting 403 and receiving 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
      "--as",
      TEST_KEY,
      "--expect",
      "403",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("PASS")
    expect(output).toContain("403")

    logSpy.mockRestore()
  })

  it("sends SIWE Authorization header with the request", async () => {
    let capturedInit: RequestInit | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
      "--as",
      TEST_KEY,
    ])

    const headers = new Headers(capturedInit?.headers)
    const authHeader = headers.get("Authorization")
    expect(authHeader).toBeTruthy()
    expect(authHeader).toMatch(/^SIWE .+\..+$/)
  })

  it("pretty-prints JSON response body", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: "hello", score: 42 }), {
            status: 200,
          }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
      "--as",
      TEST_KEY,
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain('"result": "hello"')
    expect(output).toContain('"score": 42')

    logSpy.mockRestore()
  })

  it("falls back to TOOL_SDK_PRIVATE_KEY env var", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    )
    process.env.TOOL_SDK_PRIVATE_KEY = TEST_KEY

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("PASS")

    delete process.env.TOOL_SDK_PRIVATE_KEY
    logSpy.mockRestore()
  })

  it("exits 1 when no private key is provided", async () => {
    delete process.env.TOOL_SDK_PRIVATE_KEY

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--tool-id",
        "2",
        "--endpoint",
        "https://example.com/api/invoke",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("TOOL_SDK_PRIVATE_KEY")

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("works without --tool-id", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--endpoint",
      "https://example.com/api/invoke",
      "--as",
      TEST_KEY,
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("PASS")
    expect(output).not.toContain("Tool ID:")

    logSpy.mockRestore()
  })

  it("prints timeout-specific error when request times out", async () => {
    const timeoutError = new DOMException("Signal timed out.", "TimeoutError")
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw timeoutError
      }),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--endpoint",
        "https://example.com/api/invoke",
        "--as",
        TEST_KEY,
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("Request timed out after 30s")

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("defaults to chain base (chainId 8453)", async () => {
    let capturedInit: RequestInit | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
      "--as",
      TEST_KEY,
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Base")

    const headers = new Headers(capturedInit?.headers)
    const authHeader = headers.get("Authorization")!
    const token = authHeader.slice(5)
    const dotIndex = token.lastIndexOf(".")
    const messageB64 = token.slice(0, dotIndex)
    const messageStr = Buffer.from(messageB64, "base64url").toString("utf-8")
    expect(messageStr).toContain("Chain ID: 8453")

    logSpy.mockRestore()
  })
})
