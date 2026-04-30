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
