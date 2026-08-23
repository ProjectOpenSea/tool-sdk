import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod/v4"
import { createToolHandler } from "../lib/handler/index.js"
import type { ManifestDefinition } from "../lib/manifest/index.js"
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

describe("hostedX402Gate replayGuard", () => {
  const verifyOnlyFetch = () =>
    vi.fn(async (url: string): Promise<Response> => {
      if (url.endsWith("/verify")) {
        return new Response(JSON.stringify({ isValid: true }), { status: 200 })
      }
      throw new Error(`unexpected url: ${url}`)
    })

  const paidRequest = (payload: unknown = examplePayload) =>
    new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(payload) },
    })

  it("reserves the (payer, nonce) pair scoped by network and asset", async () => {
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const reserve = vi.fn().mockResolvedValue(true)
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: { reserve },
    })

    const response = await gate.check(paidRequest(), { gates: {} })

    expect(response).toBeNull()
    expect(reserve).toHaveBeenCalledWith(
      `x402:base:${USDC_BASE_ADDRESS}:${examplePayload.payload.authorization.from}:${examplePayload.payload.authorization.nonce}`,
    )
  })

  it("returns 402 without running the handler when the authorization is already claimed", async () => {
    const fetchMock = verifyOnlyFetch()
    vi.stubGlobal("fetch", fetchMock)
    // A shared store: the first concurrent replay wins, the rest are rejected.
    const claimed = new Set<string>()
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: {
        reserve: async key => {
          if (claimed.has(key)) return false
          claimed.add(key)
          return true
        },
      },
    })

    const results = await Promise.all(
      Array.from({ length: 8 }, () => gate.check(paidRequest(), { gates: {} })),
    )

    const passed = results.filter(r => r === null)
    const rejected = results.filter((r): r is Response => r !== null)
    expect(passed).toHaveLength(1)
    expect(rejected).toHaveLength(7)
    for (const response of rejected) {
      expect(response.status).toBe(402)
      expect((await response.json()).error).toBe(
        "payment_authorization_already_used",
      )
    }
  })

  it("fails closed with 402 when the authorization is malformed", async () => {
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const reserve = vi.fn().mockResolvedValue(true)
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: { reserve },
    })
    // A key derived from junk can never collide with a real authorization, so
    // reserving it would report success while guarding nothing.
    const malformed = [
      { from: "0x", nonce: `0x${"00".repeat(32)}` },
      { from: "not-an-address", nonce: `0x${"00".repeat(32)}` },
      { from: "0x1111111111111111111111111111111111111111", nonce: "0x00" },
    ]

    for (const authorization of malformed) {
      const response = await gate.check(
        paidRequest({
          ...examplePayload,
          payload: { signature: "0xdead", authorization },
        }),
        { gates: {} },
      )
      expect(response?.status).toBe(402)
      expect((await response?.json())?.error).toBe("invalid_payload")
    }
    expect(reserve).not.toHaveBeenCalled()
  })

  it("fails closed with 402 when reserve() throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: {
        reserve: async () => {
          throw new Error("redis unreachable")
        },
      },
    })

    // A store outage is indistinguishable from a replay, so deny rather than
    // 500 or run the handler unguarded.
    const response = await gate.check(paidRequest(), { gates: {} })

    expect(response?.status).toBe(402)
    expect((await response?.json())?.error).toBe(
      "payment_authorization_already_used",
    )
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] replayGuard.reserve failed:",
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it("fails closed with 402 when reserve() hangs", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", verifyOnlyFetch())
    vi.useFakeTimers()
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      // A store that never answers must not hang the response.
      replayGuard: { reserve: () => new Promise<boolean>(() => {}) },
    })

    try {
      const pending = gate.check(paidRequest(), { gates: {} })
      await vi.advanceTimersByTimeAsync(2_000)
      const response = await pending

      expect(response?.status).toBe(402)
      expect((await response?.json())?.error).toBe(
        "payment_authorization_already_used",
      )
      expect(errorSpy).toHaveBeenCalledWith(
        "[tool-sdk] replayGuard.reserve failed:",
        expect.objectContaining({
          message: expect.stringMatching(/timed out/),
        }),
      )
    } finally {
      vi.useRealTimers()
      errorSpy.mockRestore()
    }
  })

  it("does not leak an unhandled rejection when reserve() rejects after timing out", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const rejectionSpy = vi.fn()
    process.on("unhandledRejection", rejectionSpy)
    vi.stubGlobal("fetch", verifyOnlyFetch())
    let failLate: (err: Error) => void = () => {}
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: {
        reserve: () =>
          new Promise<boolean>((_resolve, reject) => {
            failLate = reject
          }),
      },
    })

    try {
      vi.useFakeTimers()
      const pending = gate.check(paidRequest(), { gates: {} })
      await vi.advanceTimersByTimeAsync(2_000)
      expect((await pending)?.status).toBe(402)
      vi.useRealTimers()

      // The losing side of the race settles after nothing is awaiting it.
      // `Promise.race` still holds a reaction on it, so this must stay quiet
      // even if the timeout is later rewritten without a race.
      failLate(new Error("store answered too late"))
      await new Promise(resolve => setImmediate(resolve))

      expect(rejectionSpy).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      process.off("unhandledRejection", rejectionSpy)
      errorSpy.mockRestore()
    }
  })

  it("fails closed with 402 when the payload carries no identifiable authorization", async () => {
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const reserve = vi.fn().mockResolvedValue(true)
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: { reserve },
    })

    const response = await gate.check(
      paidRequest({ ...examplePayload, payload: { signature: "0xdead" } }),
      { gates: {} },
    )

    expect(response?.status).toBe(402)
    expect((await response?.json())?.error).toBe("invalid_payload")
    expect(reserve).not.toHaveBeenCalled()
  })

  it("does not reserve anything when no guard is configured", async () => {
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const gate = payaiX402Gate({ recipient: RECIPIENT, amountUsdc: "0.01" })

    const results = await Promise.all(
      Array.from({ length: 3 }, () => gate.check(paidRequest(), { gates: {} })),
    )

    // Documents the unguarded default: every replay passes verification.
    expect(results.every(r => r === null)).toBe(true)
  })

  const gateWithSettleOutcome = (
    settleOutcome: () => Promise<Response>,
    release: (key: string) => Promise<void>,
  ) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        if (url.endsWith("/settle")) return settleOutcome()
        throw new Error(`unexpected url: ${url}`)
      }),
    )
    return payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: { reserve: async () => true, release },
    })
  }

  const expectedKey = () =>
    `x402:base:${USDC_BASE_ADDRESS}:${examplePayload.payload.authorization.from}:${examplePayload.payload.authorization.nonce}`

  it("keeps the reservation when settlement fails ambiguously", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    // A transport error can just as easily mean the response was lost after
    // the facilitator broadcast. Releasing would let a replay claim the key
    // while that transaction is still pending.
    const gate = gateWithSettleOutcome(async () => {
      throw new Error("network unreachable")
    }, release)
    const ctx = { gates: {}, request: paidRequest() }

    await gate.check(ctx.request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /network unreachable/,
    )

    expect(release).not.toHaveBeenCalled()
  })

  it("keeps the reservation when the facilitator returns a 5xx", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const gate = gateWithSettleOutcome(
      async () => new Response("boom", { status: 500 }),
      release,
    )
    const ctx = { gates: {}, request: paidRequest() }

    await gate.check(ctx.request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /\/settle returned 500/,
    )

    expect(release).not.toHaveBeenCalled()
  })

  it("keeps the reservation when the facilitator rejects the authorization", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    // The nonce is spent, so no retry can ever settle it. Releasing would
    // only let another replay claim the key and fail again.
    const gate = gateWithSettleOutcome(
      async () =>
        new Response(JSON.stringify({ success: false, error: "nonce used" }), {
          status: 200,
        }),
      release,
    )
    const ctx = { gates: {}, request: paidRequest() }

    await gate.check(ctx.request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /reported failure/,
    )

    expect(release).not.toHaveBeenCalled()
  })

  it("releases the reservation when the facilitator returns a 429", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    // Throttling means the authorization was never looked at, so it is still
    // settleable and the caller should be able to retry with it.
    const gate = gateWithSettleOutcome(
      async () => new Response("slow down", { status: 429 }),
      release,
    )
    const ctx = { gates: {}, request: paidRequest() }

    await gate.check(ctx.request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /\/settle returned 429/,
    )

    expect(release).toHaveBeenCalledWith(expectedKey())
  })

  it("keeps the reservation when the facilitator returns a 4xx", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const gate = gateWithSettleOutcome(
      async () => new Response("already spent", { status: 400 }),
      release,
    )
    const ctx = { gates: {}, request: paidRequest() }

    await gate.check(ctx.request, ctx as never)
    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /\/settle returned 400/,
    )

    expect(release).not.toHaveBeenCalled()
  })

  it("keeps the reservation when settlement succeeds", async () => {
    const release = vi.fn().mockResolvedValue(undefined)
    const gate = gateWithSettleOutcome(
      async () =>
        new Response(
          JSON.stringify({
            success: true,
            transaction: "0xabc",
            network: "base",
          }),
          { status: 200 },
        ),
      release,
    )
    const ctx = { gates: {}, request: paidRequest() }

    await gate.check(ctx.request, ctx as never)
    await gate.settle?.(ctx as never)

    expect(release).not.toHaveBeenCalled()
  })

  it("surfaces the settlement error without waiting on a hung release()", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const gate = gateWithSettleOutcome(
      async () => new Response("slow down", { status: 429 }),
      // A store that never answers must not stall the response after the
      // handler has already run.
      () => new Promise<void>(() => {}),
    )
    const ctx = { gates: {}, request: paidRequest() }
    await gate.check(ctx.request, ctx as never)
    vi.useFakeTimers()

    try {
      const settling = gate.settle?.(ctx as never)
      const assertion = expect(settling).rejects.toThrow(
        /\/settle returned 429/,
      )
      await vi.advanceTimersByTimeAsync(2_000)
      await assertion

      expect(errorSpy).toHaveBeenCalledWith(
        "[tool-sdk] replayGuard.release failed:",
        expect.objectContaining({
          message: expect.stringMatching(/timed out/),
        }),
      )
    } finally {
      vi.useRealTimers()
      errorSpy.mockRestore()
    }
  })

  it("surfaces the settlement error even when release() throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string): Promise<Response> => {
        if (url.endsWith("/verify")) {
          return new Response(JSON.stringify({ isValid: true }), {
            status: 200,
          })
        }
        return new Response("slow down", { status: 429 })
      }),
    )
    const gate = payaiX402Gate({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: {
        reserve: async () => true,
        release: async () => {
          throw new Error("store unreachable")
        },
      },
    })
    const ctx = { gates: {}, request: paidRequest() }
    await gate.check(ctx.request, ctx as never)

    await expect(gate.settle?.(ctx as never)).rejects.toThrow(
      /\/settle returned 429/,
    )
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] replayGuard.release failed:",
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it("keeps the reservation when the tool handler throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const release = vi.fn().mockResolvedValue(undefined)
    // Releasing here would let a caller who can force the handler to fail
    // reuse one authorization for unlimited handler runs.
    const handler = createToolHandler({
      manifest: {
        type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
        name: "paid-tool",
        description: "A paid tool",
        endpoint: "https://tool.example.com",
        inputs: {},
        outputs: {},
        creatorAddress: RECIPIENT,
      } as ManifestDefinition,
      inputSchema: z.object({ query: z.string() }),
      outputSchema: z.object({ result: z.string() }),
      gates: [
        payaiX402Gate({
          recipient: RECIPIENT,
          amountUsdc: "0.01",
          replayGuard: { reserve: async () => true, release },
        }),
      ],
      handler: async () => {
        throw new Error("upstream API down")
      },
    })

    const response = await handler(
      new Request("https://tool.example.com/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-PAYMENT": headerFor(examplePayload),
        },
        body: JSON.stringify({ query: "test" }),
      }),
    )

    expect(response.status).toBe(500)
    expect(release).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("threads defineToolPaywall's replayGuard through to the inner gate", async () => {
    vi.stubGlobal("fetch", verifyOnlyFetch())
    const reserve = vi.fn().mockResolvedValue(false)
    const { gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      replayGuard: { reserve },
    })

    const response = await gate.check(paidRequest(), { gates: {} })

    expect(reserve).toHaveBeenCalledOnce()
    expect(response?.status).toBe(402)
    expect((await response?.json())?.error).toBe(
      "payment_authorization_already_used",
    )
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
    if (!Array.isArray(pricing)) throw new Error("expected array")
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
    if (!Array.isArray(pricing)) throw new Error("expected array")
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
    if (!Array.isArray(pricing)) throw new Error("expected array")
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

  it("accepts EnvResolver function for recipient", async () => {
    const recipientResolver = (env: Record<string, string | undefined>) =>
      (env.PAYOUT_ADDRESS ?? RECIPIENT) as `0x${string}`

    const { pricing, gate } = defineToolPaywall({
      recipient: recipientResolver,
      amountUsdc: "0.01",
    })

    // pricing should be a function when recipient is a resolver
    expect(typeof pricing).toBe("function")
    const resolvedPricing = (
      pricing as (env: Record<string, string | undefined>) => unknown[]
    )({ PAYOUT_ADDRESS: RECIPIENT })
    expect(resolvedPricing).toHaveLength(1)

    // gate.check should work (resolves recipient from process.env)
    const response = await gate.check(
      new Request("https://tool.example.com/api", { method: "POST" }),
      { gates: {} },
    )
    expect(response?.status).toBe(402)
  })

  it("calls onSettle after successful settlement", async () => {
    const settleData: { txHash?: string; payer?: string } = {}
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      const url = _url as string
      if (url.includes("/verify")) {
        return new Response(
          JSON.stringify({
            isValid: true,
            payer: "0x1111111111111111111111111111111111111111",
          }),
          { status: 200 },
        )
      }
      if (url.includes("/settle")) {
        return new Response(
          JSON.stringify({ success: true, transaction: "0xabc123" }),
          { status: 200 },
        )
      }
      return new Response("", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { gate } = defineToolPaywall({
      recipient: RECIPIENT,
      amountUsdc: "0.01",
      onSettle: ctx => {
        settleData.txHash = ctx.txHash
        settleData.payer = ctx.payer
      },
    })

    // Run check to stash payment
    const request = new Request("https://tool.example.com/api", {
      method: "POST",
      headers: { "X-Payment": headerFor(examplePayload) },
    })
    const checkResult = await gate.check(request, { gates: {} })
    expect(checkResult).toBeNull()

    // Simulate settle with a ToolContext that has the settlement tx
    const ctx = {
      gates: { x402: { paid: true, settlementTxHash: "0xabc123" } },
      manifest: {} as import("../lib/manifest/types.js").ToolManifest,
      request,
    }
    await gate.settle!(ctx as import("../types.js").ToolContext)

    expect(settleData.txHash).toBe("0xabc123")
  })
})
