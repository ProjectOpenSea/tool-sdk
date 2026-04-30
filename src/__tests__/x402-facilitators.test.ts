import { afterEach, describe, expect, it, vi } from "vitest"
import {
  CDP_X402_FACILITATOR_URL,
  cdpX402Gate,
  defineToolPaywall,
  PAYAI_X402_FACILITATOR_URL,
  payaiX402Gate,
  USDC_BASE_ADDRESS,
  x402UsdcPricing,
} from "../lib/middleware/x402-facilitators.js"

const RECIPIENT = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as const

const examplePayload = {
  x402Version: 1,
  scheme: "exact",
  network: "base",
  payload: {
    signature: "0xdeadbeef",
    authorization: {
      from: "0x1111111111111111111111111111111111111111",
      to: RECIPIENT,
      value: "10000",
      validAfter: "0",
      validBefore: "9999999999",
      nonce: `0x${"00".repeat(32)}`,
    },
  },
}

const headerFor = (payload: unknown) => globalThis.btoa(JSON.stringify(payload))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("payaiX402Gate — 402 challenge", () => {
  it("returns x402-compliant 402 with USDC-on-Base requirements when X-Payment is missing", async () => {
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
    })
    const request = new Request("https://tool.example.com/api/appraise", {
      method: "POST",
    })
    const response = await gate.check(request, { gates: {} })
    expect(response?.status).toBe(402)
    expect(response?.headers.get("X-Accept-Payment")).toBe("x402")

    const body = await response?.json()
    expect(body.x402Version).toBe(1)
    expect(body.error).toBe("X-PAYMENT header is required")
    expect(body.accepts).toHaveLength(1)
    const reqs = body.accepts[0]
    expect(reqs.scheme).toBe("exact")
    expect(reqs.network).toBe("base")
    expect(reqs.maxAmountRequired).toBe("10000")
    expect(reqs.payTo).toBe(RECIPIENT)
    expect(reqs.asset).toBe(USDC_BASE_ADDRESS)
    expect(reqs.resource).toBe("https://tool.example.com/api/appraise")
    expect(reqs.mimeType).toBe("application/json")
    expect(reqs.maxTimeoutSeconds).toBe(60)
    expect(reqs.extra).toEqual({ name: "USD Coin", version: "2" })
  })
})

describe("payaiX402Gate — facilitator verify", () => {
  it("calls the PayAI facilitator /verify with the protocol version from the payload", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = { gates: {} as Record<string, unknown> }
    const response = await gate.check(request, ctx)

    expect(response).toBeNull()
    expect(ctx.gates.x402).toEqual({ paid: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${PAYAI_X402_FACILITATOR_URL}/verify`)
    expect(init?.method).toBe("POST")
    const sentBody = JSON.parse(init?.body as string)
    expect(sentBody.x402Version).toBe(1)
    expect(sentBody.paymentPayload).toEqual(examplePayload)
    expect(sentBody.paymentRequirements.maxAmountRequired).toBe("10000")
  })

  it("does not send any auth headers (PayAI is unauthenticated)", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )

    const [, init] = fetchMock.mock.calls[0]
    const headers = init?.headers as Record<string, string>
    expect(headers).toEqual({ "Content-Type": "application/json" })
  })

  it("returns 402 with invalidReason when facilitator says isValid:false", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              isValid: false,
              invalidReason: "insufficient_funds",
            }),
            { status: 200 },
          ),
      ),
    )
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.error).toBe("insufficient_funds")
  })

  it("returns 502 when facilitator returns 5xx", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("oops", { status: 500 })),
    )
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    expect(response?.status).toBe(502)
  })

  it("returns 502 when fetch throws", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      }),
    )
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    expect(response?.status).toBe(502)
  })

  it("returns 402 invalid_payload when X-Payment is not valid base64 JSON", async () => {
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": "not-base64-json!!!" },
      }),
      { gates: {} },
    )
    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.error).toBe("invalid_payload")
  })
})

describe("cdpX402Gate — facilitator routing and auth", () => {
  it("calls the CDP facilitator URL", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = cdpX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      createAuthHeaders: async () => ({ Authorization: "Bearer test-jwt" }),
    })
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${CDP_X402_FACILITATOR_URL}/verify`)
    const headers = init?.headers as Record<string, string>
    expect(headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-jwt",
    })
  })

  it("invokes createAuthHeaders on every verify call (so JWTs can rotate)", async () => {
    const createAuthHeaders = vi.fn(async () => ({
      Authorization: "Bearer rotating",
    }))
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ isValid: true }), { status: 200 }),
      ),
    )

    const gate = cdpX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      createAuthHeaders,
    })
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    expect(createAuthHeaders).toHaveBeenCalledTimes(2)
  })

  it("surfaces 502 when no createAuthHeaders is supplied and CDP rejects with 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    )
    const gate = cdpX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toBe("Payment facilitator unreachable")
  })

  it("returns 502 (does not crash) when createAuthHeaders throws", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const gate = cdpX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      createAuthHeaders: async () => {
        throw new Error("JWT signing failed")
      },
    })
    const response = await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )
    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toBe("Payment facilitator unreachable")
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("aborts the verify fetch after the hard timeout and returns 502", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"))
            })
          }),
      )
      vi.stubGlobal("fetch", fetchMock)

      const gate = payaiX402Gate({
        recipient: RECIPIENT,
        amountUsdc: "0.01",
      })
      const responsePromise = gate.check(
        new Request("https://tool.example.com/api", {
          method: "POST",
          headers: { "X-Payment": headerFor(examplePayload) },
        }),
        { gates: {} },
      )

      await vi.advanceTimersByTimeAsync(11_000)
      const response = await responsePromise

      expect(response?.status).toBe(502)
      const body = await response?.json()
      expect(body.error).toBe("Payment facilitator unreachable")
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [, init] = fetchMock.mock.calls[0]
      expect((init as RequestInit | undefined)?.signal).toBeInstanceOf(
        AbortSignal,
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("hostedX402Gate — settle()", () => {
  it("POSTs verified payload + requirements to /settle and stashes the tx hash", async () => {
    const txHash =
      "0x6fba2b7b43c6c9f2440c68eb625a94d633e752c2101bf47d065bdb9d74e2f8d0"
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        if (url.endsWith("/settle")) {
          return new Response(
            JSON.stringify({
              success: true,
              transaction: txHash,
              network: "base",
            }),
            { status: 200 },
          )
        }
        throw new Error(`unexpected url: ${url}`)
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = {
      gates: {} as Record<string, unknown>,
      request,
    }
    await gate.check(request, ctx as never)
    expect(gate.settle).toBeDefined()
    await gate.settle?.(ctx as never)

    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [verifyUrl] = fetchMock.mock.calls[0]
    const [settleUrl, settleInit] = fetchMock.mock.calls[1]
    expect(verifyUrl).toBe(`${PAYAI_X402_FACILITATOR_URL}/verify`)
    expect(settleUrl).toBe(`${PAYAI_X402_FACILITATOR_URL}/settle`)
    expect(settleInit?.method).toBe("POST")
    const sentBody = JSON.parse(settleInit?.body as string)
    expect(sentBody.x402Version).toBe(1)
    expect(sentBody.paymentPayload).toEqual(examplePayload)
    expect(sentBody.paymentRequirements.maxAmountRequired).toBe("10000")
    expect(
      (ctx.gates.x402 as { settlementTxHash?: string }).settlementTxHash,
    ).toBe(txHash)
  })

  it("ignores handler-side ctx mutation between check() and settle()", async () => {
    // Defense in depth: an operator-authored handler that overwrites
    // ctx.gates.x402 (whether by accident or design) must not be able to
    // suppress settlement. The verified payload lives in a closure-scoped
    // WeakMap that the handler cannot reach.
    const txHash = "0xfeedfeedfeed"
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        return new Response(
          JSON.stringify({ success: true, transaction: txHash }),
          { status: 200 },
        )
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = { gates: {} as Record<string, unknown>, request }
    await gate.check(request, ctx as never)

    // Simulate a handler stomping on ctx.gates.x402 with a different
    // (unverified) payload. The gate must still settle the originally
    // verified payload, not whatever the handler put on ctx.
    ctx.gates.x402 = {
      paid: true,
      paymentPayload: { tampered: true },
      requirements: { tampered: true },
    }

    await gate.settle?.(ctx as never)

    const [, settleInit] = fetchMock.mock.calls[1]
    const sentBody = JSON.parse(settleInit?.body as string)
    expect(sentBody.paymentPayload).toEqual(examplePayload)
    expect(sentBody.paymentRequirements.maxAmountRequired).toBe("10000")
    expect(
      (sentBody.paymentPayload as { tampered?: boolean }).tampered,
    ).toBeUndefined()
  })

  it("forwards CDP auth headers to /settle", async () => {
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        return new Response(
          JSON.stringify({ success: true, transaction: "0xabc" }),
          { status: 200 },
        )
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = cdpX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      createAuthHeaders: async () => ({ Authorization: "Bearer test-jwt" }),
    })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = { gates: {} as Record<string, unknown>, request }
    await gate.check(request, ctx as never)
    await gate.settle?.(ctx as never)

    const [, settleInit] = fetchMock.mock.calls[1]
    const headers = settleInit?.headers as Record<string, string>
    expect(headers).toMatchObject({
      "Content-Type": "application/json",
      Authorization: "Bearer test-jwt",
    })
  })

  it("is a no-op when ctx has no verified payment (gate did not run)", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
    })
    await gate.settle?.({ gates: {}, request } as never)

    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("truncates a verbose facilitator error body in the thrown error message (≤256 chars)", async () => {
    const verboseBody = "x".repeat(2000)
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        return new Response(verboseBody, { status: 422 })
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = { gates: {} as Record<string, unknown>, request }
    await gate.check(request, ctx as never)

    let caught: Error | undefined
    try {
      await gate.settle?.(ctx as never)
    } catch (e) {
      caught = e as Error
    }
    expect(caught).toBeInstanceOf(Error)
    // Prefix + status + ": " + truncated body. The body slice itself is
    // capped at 256, so 256 x's should appear and zero past that.
    expect((caught as Error).message).toContain(`${"x".repeat(256)}`)
    expect((caught as Error).message).not.toContain(`${"x".repeat(257)}`)
  })

  it("throws when the facilitator returns non-2xx (caller logs and continues)", async () => {
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        return new Response("nonce already used", { status: 422 })
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = { gates: {} as Record<string, unknown>, request }
    await gate.check(request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /facilitator \/settle returned 422/,
    )
  })

  it("throws when facilitator reports success:false in body", async () => {
    const fetchMock = vi.fn(
      async (url: string, _init?: RequestInit): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        return new Response(
          JSON.stringify({ success: false, error: "insufficient_funds" }),
          { status: 200 },
        )
      },
    )
    vi.stubGlobal("fetch", fetchMock)

    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const ctx = { gates: {} as Record<string, unknown>, request }
    await gate.check(request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /insufficient_funds/,
    )
  })

  it("aborts the /settle fetch after the hard timeout (throws AbortError)", async () => {
    vi.useFakeTimers()
    try {
      const fetchMock = vi.fn(
        (url: string, init?: RequestInit): Promise<Response> => {
          if (url.endsWith("/verify")) {
            return Promise.resolve(
              new Response(JSON.stringify({ isValid: true }), { status: 200 }),
            )
          }
          return new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"))
            })
          })
        },
      )
      vi.stubGlobal("fetch", fetchMock)

      const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
      const request = new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      })
      const ctx = { gates: {} as Record<string, unknown>, request }
      await gate.check(request, ctx as never)

      // Attach .catch synchronously so the rejection has a handler the
      // moment it fires inside advanceTimersByTimeAsync. Without this,
      // Node logs an unhandled rejection warning before the later
      // `await` attaches its handler.
      let settleErr: unknown
      const settleDone = gate.settle?.(ctx as never).catch((e: unknown) => {
        settleErr = e
      })
      await vi.advanceTimersByTimeAsync(11_000)
      await settleDone

      expect(settleErr).toBeInstanceOf(Error)
      expect((settleErr as Error).name).toBe("AbortError")
      expect(fetchMock).toHaveBeenCalledTimes(2)
      const [, settleInit] = fetchMock.mock.calls[1]
      expect((settleInit as RequestInit | undefined)?.signal).toBeInstanceOf(
        AbortSignal,
      )
    } finally {
      vi.useRealTimers()
    }
  })
})

describe("amount handling (shared)", () => {
  it("treats decimal strings as USDC and converts to 6-decimal base units", async () => {
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    const body = await response?.json()
    expect(body.accepts[0].maxAmountRequired).toBe("10000")
  })

  it("treats integer strings as already-base-units", async () => {
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "10000" })
    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    const body = await response?.json()
    expect(body.accepts[0].maxAmountRequired).toBe("10000")
  })

  it("rejects amounts with more decimals than USDC supports", () => {
    expect(() =>
      payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.0000001" }),
    ).toThrow(/more than 6 decimals/)
  })

  it("rejects non-numeric amounts", () => {
    expect(() =>
      payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "free" }),
    ).toThrow(/invalid amountUsdc/)
  })

  it("rejects amountUsdc of zero (prevents accidental free paywalls)", () => {
    expect(() =>
      payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0" }),
    ).toThrow(/must be greater than 0/)
    expect(() =>
      payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.00" }),
    ).toThrow(/must be greater than 0/)
    expect(() =>
      payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.000000" }),
    ).toThrow(/must be greater than 0/)
  })

  it("rejects invalid recipient address", () => {
    expect(() =>
      payaiX402Gate({
        recipient: "0xnope" as `0x${string}`,
        amountUsdc: "0.01",
      }),
    ).toThrow(/invalid recipient address/)
  })

  it("rejects the zero address as a burn address", () => {
    expect(() =>
      payaiX402Gate({
        recipient: "0x0000000000000000000000000000000000000000",
        amountUsdc: "0.01",
      }),
    ).toThrow(/burn address/)
  })

  it("rejects the 0x…dead burn address", () => {
    expect(() =>
      payaiX402Gate({
        recipient: "0x000000000000000000000000000000000000dEaD",
        amountUsdc: "0.01",
      }),
    ).toThrow(/burn address/)
  })

  it("rejects burn addresses via x402UsdcPricing too", () => {
    expect(() =>
      x402UsdcPricing({
        recipient: "0x0000000000000000000000000000000000000000",
        amountUsdc: "0.01",
      }),
    ).toThrow(/burn address/)
  })
})

describe("base-sepolia network", () => {
  it("emits the base-sepolia USDC asset on testnet", async () => {
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      network: "base-sepolia",
    })
    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    const body = await response?.json()
    expect(body.accepts[0].network).toBe("base-sepolia")
    expect(body.accepts[0].asset).toBe(
      "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    )
  })
})

describe("x402UsdcPricing", () => {
  it("produces a CAIP-19 / CAIP-10 pricing entry matching the gate's wire price", () => {
    const pricing = x402UsdcPricing({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
    })
    expect(pricing).toEqual([
      {
        amount: "10000",
        asset: `eip155:8453/erc20:${USDC_BASE_ADDRESS}`,
        recipient: `eip155:8453:${RECIPIENT}`,
        protocol: "x402",
      },
    ])
  })

  it("uses Base Sepolia chainId on testnet", () => {
    const pricing = x402UsdcPricing({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      network: "base-sepolia",
    })
    expect(pricing[0].asset.startsWith("eip155:84532/")).toBe(true)
    expect(pricing[0].recipient.startsWith("eip155:84532:")).toBe(true)
  })
})

describe("defineToolPaywall", () => {
  it("returns pricing and gate from a single config (payai default)", () => {
    const { pricing, gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
    })

    expect(pricing).toEqual(
      x402UsdcPricing({ recipient: RECIPIENT, amountUsdc: "0.01" }),
    )
    expect(gate).toBeDefined()
    expect(typeof gate.check).toBe("function")
  })

  it("pricing amount matches the gate's enforced amount", async () => {
    const { pricing, gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
    })

    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    const body = await response?.json()
    expect(pricing[0].amount).toBe(body.accepts[0].maxAmountRequired)
  })

  it("pricing recipient matches the gate's payTo address", async () => {
    const { pricing, gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.50",
    })

    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    const body = await response?.json()
    expect(pricing[0].recipient).toBe(`eip155:8453:${RECIPIENT}`)
    expect(body.accepts[0].payTo).toBe(RECIPIENT)
  })

  it("defaults to payai facilitator", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
    })
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(`${PAYAI_X402_FACILITATOR_URL}/verify`)
  })

  it("uses cdp facilitator when facilitator is 'cdp'", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      facilitator: "cdp",
      createAuthHeaders: async () => ({ Authorization: "Bearer jwt" }),
    })
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`${CDP_X402_FACILITATOR_URL}/verify`)
    const headers = init?.headers as Record<string, string>
    expect(headers.Authorization).toBe("Bearer jwt")
  })

  it("forwards optional config fields to the gate", async () => {
    const { gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      description: "Custom tool call",
      maxTimeoutSeconds: 120,
    })

    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    const body = await response?.json()
    expect(body.accepts[0].description).toBe("Custom tool call")
    expect(body.accepts[0].maxTimeoutSeconds).toBe(120)
  })

  it("supports base-sepolia network", () => {
    const { pricing } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      network: "base-sepolia",
    })
    expect(pricing[0].asset.startsWith("eip155:84532/")).toBe(true)
    expect(pricing[0].recipient.startsWith("eip155:84532:")).toBe(true)
  })

  it("validates config (rejects invalid recipient)", () => {
    expect(() =>
      defineToolPaywall({
        recipient: "0xnope" as `0x${string}`,
        amountUsdc: "0.01",
      }),
    ).toThrow(/invalid recipient address/)
  })

  it("validates config (rejects zero amount)", () => {
    expect(() =>
      defineToolPaywall({
        recipient: RECIPIENT,
        amountUsdc: "0",
      }),
    ).toThrow(/must be greater than 0/)
  })

  it("throws when facilitator is 'cdp' without createAuthHeaders", () => {
    expect(() =>
      defineToolPaywall({
        recipient: RECIPIENT,
        amountUsdc: "0.01",
        facilitator: "cdp",
      }),
    ).toThrow(/createAuthHeaders is required when facilitator is 'cdp'/)
  })

  it("forwards facilitatorUrl to the gate", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(JSON.stringify({ isValid: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      facilitatorUrl: "https://custom-facilitator.example.com",
    })
    await gate.check(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: { "X-Payment": headerFor(examplePayload) },
      }),
      { gates: {} },
    )

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe("https://custom-facilitator.example.com/verify")
  })
})
