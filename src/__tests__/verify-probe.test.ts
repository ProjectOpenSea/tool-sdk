import { afterEach, describe, expect, it, vi } from "vitest"

const VALID_MANIFEST = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("verify command endpoint probe", () => {
  it("passes when probe returns 401", async () => {
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        callCount++
        if (url.includes(".well-known")) {
          return new Response(JSON.stringify(VALID_MANIFEST), { status: 200 })
        }
        return new Response(null, { status: 401 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { verifyCommand } = await import("../cli/commands/verify.js")

    await verifyCommand.parseAsync([
      "node",
      "verify",
      "https://test.example.com/.well-known/ai-tool/test-tool.json",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("Manifest verified successfully")
    expect(output).toContain("Endpoint probe:")
    expect(output).toContain("PASS")
    expect(callCount).toBe(2)

    logSpy.mockRestore()
  })

  it("exits non-zero when probe returns 405", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes(".well-known")) {
          return new Response(JSON.stringify(VALID_MANIFEST), { status: 200 })
        }
        return new Response(null, { status: 405 })
      }),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { verifyCommand } = await import("../cli/commands/verify.js")

    try {
      await verifyCommand.parseAsync([
        "node",
        "verify",
        "https://test.example.com/.well-known/ai-tool/test-tool.json",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("FAIL")
    expect(errorOutput).toContain("405")

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("warns but does not exit on 200 probe", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(VALID_MANIFEST), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { verifyCommand } = await import("../cli/commands/verify.js")

    await verifyCommand.parseAsync([
      "node",
      "verify",
      "https://test.example.com/.well-known/ai-tool/test-tool.json",
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("WARN")
    expect(output).toContain("gate may not be enforcing")

    logSpy.mockRestore()
  })

  it("exits non-zero when probe returns 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes(".well-known")) {
          return new Response(JSON.stringify(VALID_MANIFEST), { status: 200 })
        }
        return new Response(null, { status: 500 })
      }),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { verifyCommand } = await import("../cli/commands/verify.js")

    try {
      await verifyCommand.parseAsync([
        "node",
        "verify",
        "https://test.example.com/.well-known/ai-tool/test-tool.json",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("FAIL")
    expect(errorOutput).toContain("server error")

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })

  it("exits non-zero when probe returns 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes(".well-known")) {
          return new Response(JSON.stringify(VALID_MANIFEST), { status: 200 })
        }
        return new Response(null, { status: 404 })
      }),
    )

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { verifyCommand } = await import("../cli/commands/verify.js")

    try {
      await verifyCommand.parseAsync([
        "node",
        "verify",
        "https://test.example.com/.well-known/ai-tool/test-tool.json",
      ])
    } catch {
      // expected process.exit
    }

    const errorOutput = errorSpy.mock.calls.map(c => c[0]).join("\n")
    expect(errorOutput).toContain("FAIL")
    expect(errorOutput).toContain("handler not found")

    exitSpy.mockRestore()
    logSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
