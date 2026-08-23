import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEip3009UsageReporter } from "../lib/usage/eip3009-reporter.js"
import type { InvocationEvent } from "../types.js"

const mockFetch = vi.fn()

const OPERATOR_ADDRESS =
  "0xdef456def456def456def456def456def456def4" as `0x${string}`
const CALLER_ADDRESS =
  "0xabcdefabcdef1234567890abcdefabcdef12345678" as `0x${string}`
const PAYER_ADDRESS =
  "0x1234561234561234561234561234561234561234" as `0x${string}`
const REGISTRY_ADDRESS = "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1"

function makeConfig(
  overrides: Partial<Parameters<typeof createEip3009UsageReporter>[0]> = {},
) {
  return {
    chainId: 8453,
    toolChainId: 1,
    toolRegistryAddress: REGISTRY_ADDRESS,
    toolOnchainId: 42,
    apiKey: "test-api-key",
    aggregatorUrl: "https://test.example.com/usage",
    ...overrides,
  }
}

function makeEvent(overrides: Partial<InvocationEvent> = {}): InvocationEvent {
  return {
    paid: false,
    latencyMs: 50,
    timestamp: 1748725200000,
    toolName: "My Test Tool",
    ...overrides,
  }
}

/** A caller-supplied authorization, as the predicate gate would stash it. */
function makeCallerAuthorization() {
  return {
    signature:
      "0xfeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedfacefeedface0badc0ffeebadc0ffeebadc0ffeebadc0ffeebadc0ffeebadc0ffeebadc0ffee1b" as `0x${string}`,
    from: PAYER_ADDRESS,
    to: OPERATOR_ADDRESS,
    value: "0" as const,
    validAfter: "1748725140",
    validBefore: "1748725500",
    nonce:
      "0xcafecafecafecafecafecafecafecafecafecafecafecafecafecafecafecafe" as `0x${string}`,
    chainId: 8453,
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch)
  mockFetch.mockResolvedValue({ ok: true })
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createEip3009UsageReporter", () => {
  // -------------------------------------------------------------------------
  // x402 settlement path
  // -------------------------------------------------------------------------

  it("sends x402_settlement with composite key for paid calls", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        callerAddress: CALLER_ADDRESS,
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe("https://test.example.com/usage")
    expect(opts.method).toBe("POST")
    expect(opts.headers["x-api-key"]).toBe("test-api-key")
    const body = JSON.parse(opts.body as string)
    expect(body.verification_type).toBe("x402_settlement")
    expect(body.tool_chain_id).toBe(1)
    expect(body.tool_registry_address).toBe(REGISTRY_ADDRESS)
    expect(body.tool_onchain_id).toBe(42)
    expect(body.latency_ms).toBe(50)
    expect(body.x402).toEqual({
      caller_address: CALLER_ADDRESS,
      tx_hash: "0xtxhash123",
      chain_id: 8453,
    })
    expect(body.tool_slug).toBeUndefined()
    expect(body.eip3009).toBeUndefined()
  })

  it("uses event.payer as the x402 caller_address when callerAddress is absent", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        callerAddress: undefined,
        payer: PAYER_ADDRESS,
        paid: true,
        settlementTxHash: "0xtxhash123",
        settlementChainId: 8453,
      }),
    )

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.verification_type).toBe("x402_settlement")
    expect(body.x402.caller_address).toBe(PAYER_ADDRESS)
  })

  it("uses settlementChainId over config.chainId for x402 chain_id", async () => {
    const reporter = createEip3009UsageReporter(makeConfig({ chainId: 8453 }))

    await reporter(
      makeEvent({
        callerAddress: CALLER_ADDRESS,
        payer: PAYER_ADDRESS,
        paid: true,
        settlementTxHash: "0xtxhash123",
        settlementChainId: 1,
      }),
    )

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.x402.chain_id).toBe(1)
  })

  it("skips x402 reporting with a warning when no caller is resolvable", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        callerAddress: undefined,
        payer: undefined,
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    expect(mockFetch).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("resolvable caller address"),
    )
    warnSpy.mockRestore()
  })

  it("skips reporting with a warning when paid but no settlementTxHash", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        callerAddress: CALLER_ADDRESS,
        paid: true,
        settlementTxHash: undefined,
      }),
    )

    expect(mockFetch).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("paid invocation without settlementTxHash"),
    )
    warnSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // EIP-3009 authorization forwarding path
  // -------------------------------------------------------------------------

  it("forwards the caller's original EIP-3009 authorization", async () => {
    const auth = makeCallerAuthorization()
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent({ callerAuthorization: auth }))

    expect(mockFetch).toHaveBeenCalledOnce()
    const opts = mockFetch.mock.calls[0]![1]
    expect(opts.headers["x-api-key"]).toBe("test-api-key")
    const body = JSON.parse(opts.body as string)
    expect(body.verification_type).toBe("eip3009_authorization")
    expect(body.tool_chain_id).toBe(1)
    expect(body.tool_registry_address).toBe(REGISTRY_ADDRESS)
    expect(body.tool_onchain_id).toBe(42)
    expect(body.latency_ms).toBe(50)
    expect(body.eip3009).toEqual({
      caller_address: auth.from,
      signature: auth.signature,
      chain_id: auth.chainId,
      from: auth.from,
      to: auth.to,
      value: auth.value,
      valid_after: auth.validAfter,
      valid_before: auth.validBefore,
      nonce: auth.nonce,
    })
    expect(body.tool_slug).toBeUndefined()
  })

  it("prefers x402 settlement over a forwarded authorization for paid calls", async () => {
    const auth = makeCallerAuthorization()
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        callerAddress: CALLER_ADDRESS,
        callerAuthorization: auth,
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.verification_type).toBe("x402_settlement")
  })

  it("skips a call with no payment and no caller authorization", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent({ paid: false }))

    expect(mockFetch).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("nothing to attribute"),
    )
    warnSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Transport behavior
  // -------------------------------------------------------------------------

  it("uses default aggregator URL when not provided", async () => {
    const reporter = createEip3009UsageReporter(
      makeConfig({ aggregatorUrl: undefined }),
    )

    await reporter(
      makeEvent({ callerAuthorization: makeCallerAuthorization() }),
    )

    const url = mockFetch.mock.calls[0]![0] as string
    expect(url).toBe("https://api.opensea.io/api/v2/tools/usage")
  })

  it("logs error when response is not ok", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })

    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({ callerAuthorization: makeCallerAuthorization() }),
    )

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("eip3009 usage report failed (500)"),
    )
    errorSpy.mockRestore()
  })

  it("logs error when fetch throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({ callerAuthorization: makeCallerAuthorization() }),
    )

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("eip3009 usage report error"),
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it("swallows AbortError silently", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const abortError = new DOMException("aborted", "AbortError")
    mockFetch.mockRejectedValueOnce(abortError)

    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({ callerAuthorization: makeCallerAuthorization() }),
    )

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  // -------------------------------------------------------------------------
  // Config validation — no signing config (walletClient/operator) required
  // -------------------------------------------------------------------------

  it("constructs with only composite key + apiKey (no signing wallet)", () => {
    expect(() => createEip3009UsageReporter(makeConfig())).not.toThrow()
  })

  it("throws for empty toolRegistryAddress", () => {
    expect(() =>
      createEip3009UsageReporter(makeConfig({ toolRegistryAddress: "" })),
    ).toThrow("toolRegistryAddress must not be empty")
  })

  it("accepts x402:bankr registry and string onchainId", () => {
    expect(() =>
      createEip3009UsageReporter(
        makeConfig({
          toolRegistryAddress: "x402:bankr",
          toolOnchainId: "5311379622895099236",
        }),
      ),
    ).not.toThrow()
  })

  it("throws for negative toolOnchainId", () => {
    expect(() =>
      createEip3009UsageReporter(makeConfig({ toolOnchainId: -1 })),
    ).toThrow("toolOnchainId must be a non-negative integer")
  })

  it("throws for non-integer toolChainId", () => {
    expect(() =>
      createEip3009UsageReporter(makeConfig({ toolChainId: 1.5 })),
    ).toThrow("toolChainId must be a positive integer")
  })

  it("throws for empty apiKey", () => {
    expect(() =>
      createEip3009UsageReporter(makeConfig({ apiKey: "" })),
    ).toThrow("apiKey is required")
  })

  it("throws for whitespace-only apiKey", () => {
    expect(() =>
      createEip3009UsageReporter(makeConfig({ apiKey: "   " })),
    ).toThrow("apiKey is required")
  })

  it("throws for non-positive chainId", () => {
    expect(() =>
      createEip3009UsageReporter(makeConfig({ chainId: 0 })),
    ).toThrow("chainId must be a positive integer")
  })

  // Every branch of this reporter sends `x-api-key`, and the EIP-3009 branch
  // forwards the caller's signed authorization too. reportCallerX402Usage has
  // refused a plaintext aggregatorUrl since it was written; this one did not.
  it("refuses to send over an insecure http aggregatorUrl", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter(
      makeConfig({ aggregatorUrl: "http://evil.example/usage" }),
    )
    await reporter(
      makeEvent({
        paid: true,
        settlementTxHash:
          "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        payer: PAYER_ADDRESS,
      }),
    )

    expect(mockFetch).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("insecure aggregatorUrl"),
    )
  })

  it("refuses the EIP-3009 branch over an insecure http aggregatorUrl too", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter(
      makeConfig({ aggregatorUrl: "http://evil.example/usage" }),
    )
    await reporter(
      makeEvent({
        callerAddress: CALLER_ADDRESS,
        callerAuthorization: makeCallerAuthorization(),
      }),
    )

    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("allows http://localhost for local dev", async () => {
    const reporter = createEip3009UsageReporter(
      makeConfig({ aggregatorUrl: "http://localhost:3000/usage" }),
    )
    await reporter(
      makeEvent({
        paid: true,
        settlementTxHash:
          "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        payer: PAYER_ADDRESS,
      }),
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    expect(mockFetch.mock.calls[0]![0]).toBe("http://localhost:3000/usage")
  })
})
