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
  delete process.env.PRIVATE_KEY
  delete process.env.RPC_URL
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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--tool-id",
        "2",
        "--endpoint",
        "https://example.com/api/invoke",
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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--tool-id",
      "2",
      "--endpoint",
      "https://example.com/api/invoke",
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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

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
    expect(output).toContain('"result": "hello"')
    expect(output).toContain('"score": 42')

    logSpy.mockRestore()
  })

  it("falls back to PRIVATE_KEY env var", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    )
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

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

    logSpy.mockRestore()
  })

  it("exits 1 when no wallet env vars are set", async () => {
    delete process.env.PRIVATE_KEY

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
    expect(errorOutput).toContain("PRIVATE_KEY")

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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--endpoint",
      "https://example.com/api/invoke",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("PASS")
    expect(output).not.toContain("Tool ID:")

    logSpy.mockRestore()
  })

  it("prints timeout-specific error when probe times out", async () => {
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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--endpoint",
        "https://example.com/api/invoke",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("Endpoint probe timed out after 10s")

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
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

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

  it("exits before SIWE signing when probe returns 405", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 405 })),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--endpoint",
        "https://example.com/api/invoke",
      ])
    } catch {
      // expected process.exit
    }

    const allOutput = [
      ...logSpy.mock.calls.map(c => c[0]),
      ...errorSpy.mock.calls.map(c => c[0]),
    ].join("\n")
    expect(allOutput).toContain("FAIL")
    expect(allOutput).toContain("405")
    expect(allOutput).not.toContain("Building SIWE message")

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("exits before SIWE signing when probe returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    try {
      await smokeCommand.parseAsync([
        "node",
        "smoke",
        "--endpoint",
        "https://example.com/api/invoke",
      ])
    } catch {
      // expected process.exit
    }

    const allOutput = [
      ...logSpy.mock.calls.map(c => c[0]),
      ...errorSpy.mock.calls.map(c => c[0]),
    ].join("\n")
    expect(allOutput).toContain("FAIL")
    expect(allOutput).toContain("handler not found")
    expect(allOutput).not.toContain("Building SIWE message")

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("proceeds to SIWE when probe returns 401", async () => {
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(null, { status: 401 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--endpoint",
      "https://example.com/api/invoke",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Endpoint probe:")
    expect(output).toContain("PASS")
    expect(output).toContain("Building SIWE message")

    logSpy.mockRestore()
  })

  it("proceeds to SIWE when probe warns (200 without auth)", async () => {
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(null, { status: 200 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = TEST_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { smokeCommand } = await import("../cli/commands/smoke.js")

    await smokeCommand.parseAsync([
      "node",
      "smoke",
      "--endpoint",
      "https://example.com/api/invoke",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("WARN")
    expect(output).toContain("gate may not be enforcing")
    expect(output).toContain("Building SIWE message")

    logSpy.mockRestore()
  })
})
