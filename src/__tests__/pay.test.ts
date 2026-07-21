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

describe("parseToolRef", () => {
  const REGISTRY = "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1"

  it("parses chainId,registryAddress,onchainId for onchain tools", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(parseToolRef(`8453,${REGISTRY},65`)).toEqual({
      toolChainId: 8453,
      toolRegistryAddress: REGISTRY,
      toolOnchainId: "65",
    })
  })

  it("normalizes an x402:bazaar registry to the public source token", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(parseToolRef("8453,x402:bazaar,8679018179619845322")).toEqual({
      toolChainId: 8453,
      toolRegistryAddress: "x402_bazaar",
      toolOnchainId: "8679018179619845322",
    })
  })

  it("normalizes x402 registry names case-insensitively", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(parseToolRef("8453,X402:BANKR,5311379622895099236")).toEqual({
      toolChainId: 8453,
      toolRegistryAddress: "x402_bankr",
      toolOnchainId: "5311379622895099236",
    })
  })

  it("preserves canonical x402 source tokens", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(parseToolRef("8453,x402_bazaar,123").toolRegistryAddress).toBe(
      "x402_bazaar",
    )
    expect(parseToolRef("8453,x402_bankr,123").toolRegistryAddress).toBe(
      "x402_bankr",
    )
  })

  it("preserves an onchain id beyond Number.MAX_SAFE_INTEGER as a string", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    const big = "9007199254740993" // 2^53 + 1, not representable as a JS number
    expect(parseToolRef(`8453,x402_bazaar,${big}`).toolOnchainId).toBe(big)
  })

  it("accepts onchain id 0", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(parseToolRef(`8453,${REGISTRY},0`).toolOnchainId).toBe("0")
  })

  it("throws when the ref does not have exactly three comma fields", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(() => parseToolRef(`8453,${REGISTRY}`)).toThrow(/tool-ref/)
    expect(() => parseToolRef(`8453,${REGISTRY},65,extra`)).toThrow(/tool-ref/)
  })

  it("throws on a non-numeric chain id", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(() => parseToolRef(`base,${REGISTRY},65`)).toThrow(/chain/i)
  })

  it("throws on an empty registry", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(() => parseToolRef("8453,,65")).toThrow(/registry/i)
  })

  it("throws on a non-numeric onchain id", async () => {
    const { parseToolRef } = await import("../cli/commands/pay.js")
    expect(() => parseToolRef(`8453,${REGISTRY},abc`)).toThrow(/onchain/i)
  })
})

describe("pay command", () => {
  it("probes for 402 then replays with X-Payment header", async () => {
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })

      // v1 servers read the X-PAYMENT header (case-insensitive).
      if (!headers["x-payment"]) {
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

    // First call: probe (no payment header)
    expect(calls[0].headers["x-payment"]).toBeUndefined()

    // Second call: paid request (with X-PAYMENT for v1)
    expect(calls[1].headers["x-payment"]).toBeDefined()

    // Verify the X-PAYMENT header is valid base64 JSON
    const paymentPayload = JSON.parse(
      Buffer.from(calls[1].headers["x-payment"], "base64").toString("utf-8"),
    )
    expect(paymentPayload.x402Version).toBe(1)
    expect(paymentPayload.scheme).toBe("exact")
    expect(paymentPayload.payload.signature).toBeDefined()
    expect(paymentPayload.payload.authorization.to).toBe(
      PAYMENT_REQUIREMENTS.payTo,
    )

    logSpy.mockRestore()
  })

  it("uses upto scheme when challenge specifies scheme: upto", async () => {
    const uptoRequirements = { ...PAYMENT_REQUIREMENTS, scheme: "upto" }
    const calls: { url: string; headers: Record<string, string> }[] = []

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
      ) as Record<string, string>
      calls.push({ url: url as string, headers })

      if (!headers["x-payment"]) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            error: "Payment required",
            accepts: [uptoRequirements],
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

    const paymentPayload = JSON.parse(
      Buffer.from(calls[1].headers["x-payment"], "base64").toString("utf-8"),
    )
    expect(paymentPayload.x402Version).toBe(1)
    expect(paymentPayload.scheme).toBe("upto")
    expect(paymentPayload.payload.signature).toBeDefined()
    expect(paymentPayload.payload.authorization.to).toBe(
      PAYMENT_REQUIREMENTS.payTo,
    )

    logSpy.mockRestore()
  })

  it("falls back to GET when an unspecified-method POST probe 404s", async () => {
    const calls: { method?: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
      ) as Record<string, string>
      calls.push({ method: init?.method })

      if (init?.method === "POST") {
        return new Response("Cannot POST /x", { status: 404 })
      }
      if (!headers["x-payment"]) {
        return new Response(
          JSON.stringify({ x402Version: 1, accepts: [PAYMENT_REQUIREMENTS] }),
          { status: 402 },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })

    vi.stubGlobal("fetch", fetchMock)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://x402.example.com/x",
      "--body",
      "{}",
    ])

    expect(calls[0].method).toBe("POST")
    expect(calls[1].method).toBe("GET")
    expect(calls[2].method).toBe("GET")
    logSpy.mockRestore()
  })

  it("calls a GET endpoint with query params and a v2 header challenge", async () => {
    const calls: {
      url: string
      method?: string
      headers: Record<string, string>
    }[] = []

    const challenge = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "6000",
          payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    }
    const header = Buffer.from(JSON.stringify(challenge)).toString("base64")

    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const headers = Object.fromEntries(
        new Headers(init?.headers).entries(),
      ) as Record<string, string>
      calls.push({ url: url as string, method: init?.method, headers })

      // A v2 server reads PAYMENT-SIGNATURE, not X-PAYMENT.
      if (!headers["payment-signature"]) {
        return new Response("{}", {
          status: 402,
          headers: { "payment-required": header },
        })
      }
      return new Response(JSON.stringify({ data: [{ id: "1" }] }), {
        status: 200,
      })
    })

    vi.stubGlobal("fetch", fetchMock)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://x402.example.com/tweets/search",
      "--method",
      "GET",
      "--body",
      '{"words":"tiny dinos","from":"codincowboy"}',
    ])

    expect(fetchMock).toHaveBeenCalledTimes(2)
    // Params go in the query string, not a body.
    expect(calls[0].method).toBe("GET")
    expect(calls[0].url).toContain("words=tiny+dinos")
    expect(calls[0].url).toContain("from=codincowboy")
    // Retry carries the v2 PAYMENT-SIGNATURE header with the v2 envelope.
    expect(calls[1].headers["payment-signature"]).toBeDefined()
    expect(calls[1].headers["x-payment"]).toBeUndefined()
    const payload = JSON.parse(
      Buffer.from(calls[1].headers["payment-signature"], "base64").toString(
        "utf-8",
      ),
    )
    expect(payload.x402Version).toBe(2)
    // v2 envelope: no top-level scheme/network; requirement echoed in `accepted`.
    expect(payload.accepted.network).toBe("eip155:8453")
    expect(payload.accepted.amount).toBe("6000")
    expect(payload.payload.authorization.value).toBe("6000")

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

  it("does NOT fall back to GET when --method is set explicitly", async () => {
    // An explicit --method means the user asked for that verb; a 404/405 is a
    // real failure to surface, not a cue to silently retry as GET.
    const calls: { method?: string }[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push({ method: init?.method })
      return new Response("Cannot POST /x", { status: 404 })
    })

    vi.stubGlobal("fetch", fetchMock)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await payCommand.parseAsync([
      "node",
      "pay",
      "https://x402.example.com/x",
      "--method",
      "POST",
      "--body",
      "{}",
    ])

    // Single call, no GET retry — the 404 is reported as-is.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(calls[0].method).toBe("POST")
    logSpy.mockRestore()
  })

  it("refuses to sign when the challenge exceeds the default max amount", async () => {
    // 20 USDC, above the 10 USDC default cap.
    const overCap = { ...PAYMENT_REQUIREMENTS, maxAmountRequired: "20000000" }
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ x402Version: 1, accepts: [overCap] }), {
          status: 402,
        }),
    )
    vi.stubGlobal("fetch", fetchMock)
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit")
    }) as never)
    process.env.PRIVATE_KEY = PRIVATE_KEY
    process.env.RPC_URL = "http://localhost:8545"

    const { payCommand } = await import("../cli/commands/pay.js")

    await expect(
      payCommand.parseAsync([
        "node",
        "pay",
        "https://tool.example.com/api",
        "--body",
        "{}",
      ]),
    ).rejects.toThrow("process.exit")

    // No second (paid) fetch happened — we bailed before signing.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const errOutput = errSpy.mock.calls.flat().join(" ")
    expect(errOutput).toContain("maxAmount")

    logSpy.mockRestore()
    errSpy.mockRestore()
    exitSpy.mockRestore()
  })
})
