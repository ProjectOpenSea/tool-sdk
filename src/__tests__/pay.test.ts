import { writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it, vi } from "vitest"

// Hardhat/Anvil account #0 — deterministic test key, never holds real funds
const PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"

const PAYMENT_REQUIREMENTS = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "10000",
  payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  extra: { name: "USD Coin", version: "2" },
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  delete process.env.PRIVATE_KEY
  delete process.env.RPC_URL
})

describe("pay command", () => {
  it("probes for 402 then replays with X-Payment header", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })

      if (!headers["X-Payment"]) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            error: "Payment required",
            accepts: [PAYMENT_REQUIREMENTS],
          }),
          { status: 402 },
        )
      }

      return new Response(
        JSON.stringify({ result: "success", txHash: "0xabc" }),
        { status: 200 },
      )
    })

    vi.stubGlobal("fetch", fetchMock)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://tool.example.com/api",
      "--body",
      '{"query":"test"}',
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)

    // First call: probe (no X-Payment)
    expect(calls[0].headers["X-Payment"]).toBeUndefined()

    // Second call: paid request (with X-Payment)
    expect(calls[1].headers["X-Payment"]).toBeDefined()

    // Verify the X-Payment header is valid base64 JSON
    const paymentPayload = JSON.parse(
      Buffer.from(calls[1].headers["X-Payment"], "base64").toString("utf-8"),
    )
    expect(paymentPayload.x402Version).toBe(1)
    expect(paymentPayload.scheme).toBe("exact")
    expect(paymentPayload.payload.signature).toBeDefined()
    expect(paymentPayload.payload.authorization.to).toBe(
      PAYMENT_REQUIREMENTS.payTo,
    )

    logSpy.mockRestore()
  })

  it("prints response without payment when endpoint does not return 402", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: "free" }), { status: 200 }),
      ),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://tool.example.com/api",
      "--body",
      "{}",
    ])

    // Only one fetch call (no paid replay)
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

    logSpy.mockRestore()
  })
})

describe("pay --auth eip3009", () => {
  it("uses paidAuthenticatedFetch when --auth siwe is set (deprecated, maps to EIP-3009)", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        Object.entries(init?.headers ?? {}),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })

      // First call has Authorization (EIP-3009) but no X-Payment → return 402
      if (headers.Authorization && !headers["X-Payment"]) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            error: "Payment required",
            accepts: [PAYMENT_REQUIREMENTS],
          }),
          { status: 402 },
        )
      }

      // Second call has both Authorization and X-Payment → success
      if (headers.Authorization && headers["X-Payment"]) {
        return new Response(JSON.stringify({ result: "authenticated-paid" }), {
          status: 200,
        })
      }

      return new Response("Unexpected", { status: 500 })
    })

    vi.stubGlobal("fetch", fetchMock)

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://tool.example.com/api",
      "--body",
      '{"query":"test"}',
      "--auth",
      "siwe",
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)

    // First call: EIP-3009 auth, no payment
    expect(calls[0].headers.Authorization).toMatch(/^EIP-3009 /)
    expect(calls[0].headers["X-Payment"]).toBeUndefined()

    // Second call: EIP-3009 auth + payment
    expect(calls[1].headers.Authorization).toMatch(/^EIP-3009 /)
    expect(calls[1].headers["X-Payment"]).toBeDefined()

    logSpy.mockRestore()
  })

  it("returns directly when --auth siwe response is not 402", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        const headers = Object.fromEntries(
          Object.entries(init?.headers ?? {}),
        ) as Record<string, string>

        if (headers.Authorization) {
          return new Response(JSON.stringify({ result: "auth-only" }), {
            status: 200,
          })
        }

        return new Response("Unexpected", { status: 500 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://tool.example.com/api",
      "--auth",
      "siwe",
      "--body",
      "{}",
    ])

    // Only one fetch call — no 402 so no payment replay
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1)

    logSpy.mockRestore()
  })

  it("auto-enables EIP-3009 auth when manifest declares an access block", async () => {
    const manifest = {
      type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
      name: "Test Tool",
      description: "A test tool",
      endpoint: "https://tool.example.com/api",
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      access: {
        logic: "AND",
        requirements: [
          {
            kind: "0xdeadbeef",
            data: "0x",
            label: "Test gate",
          },
        ],
      },
    }

    const manifestPath = join(tmpdir(), `test-manifest-${Date.now()}.json`)
    writeFileSync(manifestPath, JSON.stringify(manifest))

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

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://tool.example.com/api",
      "--manifest",
      manifestPath,
      "--body",
      "{}",
    ])

    // Should have used EIP-3009 auth (paidAuthenticatedFetch adds Authorization header)
    expect(calls[0].headers.Authorization).toMatch(/^EIP-3009 /)

    logSpy.mockRestore()
  })

  it("does not auto-enable auth when manifest has no access block", async () => {
    const manifest = {
      type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
      name: "Test Tool",
      description: "A test tool",
      endpoint: "https://tool.example.com/api",
      inputs: { type: "object", properties: {} },
      outputs: { type: "object", properties: {} },
      creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    }

    const manifestPath = join(
      tmpdir(),
      `test-manifest-no-access-${Date.now()}.json`,
    )
    writeFileSync(manifestPath, JSON.stringify(manifest))

    const calls: { url: string; headers: Record<string, string> }[] = []

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const headers = Object.fromEntries(
          Object.entries(init?.headers ?? {}),
        ) as Record<string, string>
        calls.push({ url: url as string, headers })

        return new Response(JSON.stringify({ result: "free" }), { status: 200 })
      }),
    )

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://tool.example.com/api",
      "--manifest",
      manifestPath,
      "--body",
      "{}",
    ])

    // Should NOT have used auth — no Authorization header
    expect(calls[0].headers.Authorization).toBeUndefined()

    logSpy.mockRestore()
  })
})
