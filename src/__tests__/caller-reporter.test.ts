import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { extractSettlementTxHash } from "../lib/client/x402-payment.js"
import type {
  CallerEip3009UsageEvent,
  CallerUsageReporterConfig,
  CallerX402UsageEvent,
} from "../lib/usage/caller-reporter.js"
import {
  reportCallerEip3009Usage,
  reportCallerX402Usage,
} from "../lib/usage/caller-reporter.js"

const CALLER_ADDRESS =
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as `0x${string}`
const VALID_TX_HASH =
  "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1"

function makeX402Event(
  overrides: Partial<CallerX402UsageEvent> = {},
): CallerX402UsageEvent {
  return {
    toolEndpoint: "https://tool.example/api",
    callerAddress: CALLER_ADDRESS,
    txHash: VALID_TX_HASH,
    chainId: 8453,
    ...overrides,
  }
}

function makeEip3009Event(
  overrides: Partial<CallerEip3009UsageEvent> = {},
): CallerEip3009UsageEvent {
  return {
    toolEndpoint: "https://tool.example/api",
    callerAddress: CALLER_ADDRESS,
    signature: "0xdeadbeef" as `0x${string}`,
    chainId: 8453,
    from: CALLER_ADDRESS,
    to: "0x1234567890123456789012345678901234567890" as `0x${string}`,
    value: "0",
    validAfter: "0",
    validBefore: "999999999999",
    nonce: "0x0000000000000000000000000000000000000000000000000000000000000001",
    ...overrides,
  }
}

function makeConfig(
  overrides: Partial<CallerUsageReporterConfig> = {},
): CallerUsageReporterConfig {
  return {
    apiKey: "test-api-key",
    ...overrides,
  }
}

describe("reportCallerX402Usage", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "uuid", verified: true }), {
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("posts x402 settlement with correct body structure", async () => {
    const result = await reportCallerX402Usage(makeX402Event(), makeConfig())
    expect(result.outcome).toBe("reported")

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]!
    expect(url).toBe("https://api.opensea.io/api/v2/tools/usage")
    expect(opts.headers["x-api-key"]).toBe("test-api-key")

    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      verification_type: "x402_settlement",
      tool_endpoint: "https://tool.example/api",
      latency_ms: undefined,
      x402: {
        caller_address: CALLER_ADDRESS,
        tx_hash: VALID_TX_HASH,
        chain_id: 8453,
      },
    })
  })

  it("includes latency_ms when provided", async () => {
    await reportCallerX402Usage(makeX402Event({ latencyMs: 250 }), makeConfig())

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    expect(body.latency_ms).toBe(250)
  })

  it("sends the ERC-8257 composite key in place of tool_endpoint when provided", async () => {
    const result = await reportCallerX402Usage(
      makeX402Event({
        toolChainId: 8453,
        toolRegistryAddress: "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1",
        toolOnchainId: 65,
      }),
      makeConfig(),
    )
    expect(result.outcome).toBe("reported")

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    expect(body.tool_chain_id).toBe(8453)
    expect(body.tool_registry_address).toBe(
      "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1",
    )
    expect(body.tool_onchain_id).toBe(65)
    // The composite key is sent INSTEAD of the (ambiguous) endpoint.
    expect(body.tool_endpoint).toBeUndefined()
    expect(body.x402).toEqual({
      caller_address: CALLER_ADDRESS,
      tx_hash: VALID_TX_HASH,
      chain_id: 8453,
    })
  })

  it("sends x402:bazaar registry and string onchainId in the composite key", async () => {
    const result = await reportCallerX402Usage(
      makeX402Event({
        toolChainId: 8453,
        toolRegistryAddress: "x402:bazaar",
        toolOnchainId: "8679018179619845322",
      }),
      makeConfig(),
    )
    expect(result.outcome).toBe("reported")

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    expect(body.tool_chain_id).toBe(8453)
    expect(body.tool_registry_address).toBe("x402:bazaar")
    expect(body.tool_onchain_id).toBe("8679018179619845322")
    expect(body.tool_endpoint).toBeUndefined()
  })

  it("skips the report when only partial composite coordinates are given", async () => {
    const result = await reportCallerX402Usage(
      // chainId without registry/onchainId — must be all-or-nothing.
      makeX402Event({ toolChainId: 8453 }),
      makeConfig(),
    )
    expect(result.outcome).toBe("skipped")
    expect(result.detail).toMatch(/coordinates/i)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("skips the report when the composite registry address is empty", async () => {
    const result = await reportCallerX402Usage(
      makeX402Event({
        toolChainId: 8453,
        toolRegistryAddress: "",
        toolOnchainId: 65,
      }),
      makeConfig(),
    )
    expect(result.outcome).toBe("skipped")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("uses custom aggregatorUrl when provided", async () => {
    await reportCallerX402Usage(
      makeX402Event(),
      makeConfig({ aggregatorUrl: "https://custom.endpoint/usage" }),
    )

    const [url] = fetchSpy.mock.calls[0]!
    expect(url).toBe("https://custom.endpoint/usage")
  })

  it("skips report and logs error for invalid callerAddress", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    await reportCallerX402Usage(
      makeX402Event({ callerAddress: "0xinvalid" as `0x${string}` }),
      makeConfig(),
    )

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid callerAddress"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("refuses to send over an insecure http aggregatorUrl", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const result = await reportCallerX402Usage(
      makeX402Event(),
      makeConfig({ aggregatorUrl: "http://evil.example/usage" }),
    )

    expect(result.outcome).toBe("skipped")
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("insecure aggregatorUrl"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("allows http://localhost for local dev", async () => {
    await reportCallerX402Usage(
      makeX402Event(),
      makeConfig({ aggregatorUrl: "http://localhost:3000/usage" }),
    )

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url] = fetchSpy.mock.calls[0]!
    expect(url).toBe("http://localhost:3000/usage")
  })

  it("treats a duplicate-report 400 as success without logging an error", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          errors: ["Duplicate usage report: tx_hash 0xabc already reported"],
        }),
        { status: 400 },
      ),
    )
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await reportCallerX402Usage(makeX402Event(), makeConfig())

    // The creator's server-side reporter already recorded this settlement;
    // from the caller's side the usage IS reported, so no error is logged.
    expect(result.outcome).toBe("already-reported")
    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it("skips report and logs error for malformed txHash", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    await reportCallerX402Usage(
      makeX402Event({ txHash: "0xshort" }),
      makeConfig(),
    )

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid txHash"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("logs error on non-OK response without throwing", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    )
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const result = await reportCallerX402Usage(makeX402Event(), makeConfig())

    expect(result.outcome).toBe("failed")
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("caller usage report failed (401)"),
    )
  })

  it("handles fetch abort without throwing", async () => {
    fetchSpy.mockImplementationOnce(
      () =>
        new Promise((_, reject) => {
          const err = new Error("aborted")
          err.name = "AbortError"
          reject(err)
        }),
    )
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await reportCallerX402Usage(makeX402Event(), makeConfig({ timeoutMs: 1 }))

    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it("handles network errors without throwing", async () => {
    fetchSpy.mockRejectedValueOnce(new Error("network failure"))
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    await reportCallerX402Usage(makeX402Event(), makeConfig())

    expect(consoleSpy).toHaveBeenCalledWith(
      "[tool-sdk] caller x402 usage report error:",
      expect.any(Error),
    )
  })

  it("auto-provisions API key when not provided", async () => {
    fetchSpy
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ api_key: "auto-key" }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ verified: true }), { status: 200 }),
      )

    await reportCallerX402Usage(makeX402Event(), {})

    expect(fetchSpy).toHaveBeenCalledTimes(2)
    const [provisionUrl] = fetchSpy.mock.calls[0]!
    expect(provisionUrl).toBe("https://api.opensea.io/api/v2/auth/keys")

    const [, reportOpts] = fetchSpy.mock.calls[1]!
    expect(reportOpts.headers["x-api-key"]).toBe("auto-key")
  })

  it("does not abort shared API-key provisioning when one caller times out", async () => {
    vi.useFakeTimers()
    try {
      const abortError = () => {
        const err = new Error("aborted")
        err.name = "AbortError"
        return err
      }

      let resolveProvision = (_response: Response) => {}
      fetchSpy.mockImplementation((input, init) => {
        const url = String(input)
        const signal = init?.signal as AbortSignal | undefined

        if (url.endsWith("/api/v2/auth/keys")) {
          return new Promise<Response>((resolve, reject) => {
            if (signal?.aborted) {
              reject(abortError())
              return
            }
            const onAbort = () => reject(abortError())
            signal?.addEventListener("abort", onAbort, { once: true })
            resolveProvision = response => {
              signal?.removeEventListener("abort", onAbort)
              resolve(response)
            }
          })
        }

        if (signal?.aborted) {
          return Promise.reject(abortError())
        }

        return new Promise<Response>((resolve, reject) => {
          queueMicrotask(() => {
            if (signal?.aborted) {
              reject(abortError())
              return
            }
            resolve(
              new Response(JSON.stringify({ verified: true }), {
                status: 200,
              }),
            )
          })
        })
      })

      const origin = "https://shared-provision.example"
      const first = reportCallerX402Usage(
        makeX402Event({ toolEndpoint: "https://tool.example/api" }),
        makeConfig({
          aggregatorUrl: `${origin}/api/v2/tools/usage`,
          timeoutMs: 1,
        }),
      )
      const second = reportCallerX402Usage(
        makeX402Event({ toolEndpoint: "https://tool.example/api" }),
        makeConfig({
          aggregatorUrl: `${origin}/api/v2/tools/usage`,
          timeoutMs: 1_000,
        }),
      )

      await vi.advanceTimersByTimeAsync(1)
      resolveProvision(
        new Response(JSON.stringify({ api_key: "shared-key" }), {
          status: 200,
        }),
      )

      const [, secondResult] = await Promise.all([first, second])

      expect(secondResult.outcome).toBe("reported")
      expect(fetchSpy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("skips report when auto-provisioning fails", async () => {
    fetchSpy.mockResolvedValueOnce(new Response("error", { status: 500 }))
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    // Use a different origin so the cached key from the previous test doesn't interfere
    await reportCallerX402Usage(makeX402Event(), {
      aggregatorUrl: "https://staging.opensea.io/api/v2/tools/usage",
    })

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no API key available"),
    )
    expect(fetchSpy).toHaveBeenCalledTimes(1)
  })
})

describe("reportCallerEip3009Usage", () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    fetchSpy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "uuid", verified: true }), {
        status: 200,
      }),
    )
    vi.stubGlobal("fetch", fetchSpy)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("posts eip3009 authorization with correct body structure", async () => {
    const event = makeEip3009Event()
    await reportCallerEip3009Usage(event, makeConfig())

    expect(fetchSpy).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    expect(body).toEqual({
      verification_type: "eip3009_authorization",
      tool_endpoint: "https://tool.example/api",
      latency_ms: undefined,
      eip3009: {
        caller_address: CALLER_ADDRESS,
        signature: "0xdeadbeef",
        chain_id: 8453,
        from: CALLER_ADDRESS,
        to: "0x1234567890123456789012345678901234567890",
        value: "0",
        valid_after: "0",
        valid_before: "999999999999",
        nonce:
          "0x0000000000000000000000000000000000000000000000000000000000000001",
      },
    })
  })

  it("skips report for invalid callerAddress", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    await reportCallerEip3009Usage(
      makeEip3009Event({ callerAddress: "bad" as `0x${string}` }),
      makeConfig(),
    )

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid callerAddress"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("warns about front-running when reporting a non-zero value", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    await reportCallerEip3009Usage(
      makeEip3009Event({ value: "1000000" }),
      makeConfig(),
    )

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("non-zero value"),
    )
    // Telemetry is still sent — the warning surfaces misuse without dropping data.
    expect(fetchSpy).toHaveBeenCalledOnce()
  })

  it("refuses to send over an insecure http aggregatorUrl", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    await reportCallerEip3009Usage(
      makeEip3009Event(),
      makeConfig({ aggregatorUrl: "http://evil.example/usage" }),
    )

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("insecure aggregatorUrl"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("extractSettlementTxHash", () => {
  it("extracts tx hash from PAYMENT-RESPONSE header", () => {
    const txHash = "0xabc123"
    const encoded = btoa(JSON.stringify({ transaction: txHash }))
    const res = new Response(null, {
      headers: { "PAYMENT-RESPONSE": encoded },
    })

    expect(extractSettlementTxHash(res)).toBe(txHash)
  })

  it("extracts tx hash from X-PAYMENT-RESPONSE header", () => {
    const txHash = "0xdef456"
    const encoded = btoa(JSON.stringify({ transaction: txHash }))
    const res = new Response(null, {
      headers: { "X-PAYMENT-RESPONSE": encoded },
    })

    expect(extractSettlementTxHash(res)).toBe(txHash)
  })

  it("prefers PAYMENT-RESPONSE over X-PAYMENT-RESPONSE", () => {
    const v2Hash = "0xv2hash"
    const v1Hash = "0xv1hash"
    const res = new Response(null, {
      headers: {
        "PAYMENT-RESPONSE": btoa(JSON.stringify({ transaction: v2Hash })),
        "X-PAYMENT-RESPONSE": btoa(JSON.stringify({ transaction: v1Hash })),
      },
    })

    expect(extractSettlementTxHash(res)).toBe(v2Hash)
  })

  it("returns undefined when no settlement header present", () => {
    const res = new Response(null)
    expect(extractSettlementTxHash(res)).toBeUndefined()
  })

  it("returns undefined for invalid base64", () => {
    const res = new Response(null, {
      headers: { "PAYMENT-RESPONSE": "not-valid-base64!!!" },
    })
    expect(extractSettlementTxHash(res)).toBeUndefined()
  })

  it("returns undefined when decoded JSON has no transaction field", () => {
    const encoded = btoa(JSON.stringify({ other: "data" }))
    const res = new Response(null, {
      headers: { "PAYMENT-RESPONSE": encoded },
    })
    expect(extractSettlementTxHash(res)).toBeUndefined()
  })
})
