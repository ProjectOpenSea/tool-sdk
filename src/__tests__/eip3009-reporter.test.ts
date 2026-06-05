import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEip3009UsageReporter } from "../lib/usage/eip3009-reporter.js"
import type { InvocationEvent } from "../types.js"

const mockFetch = vi.fn()
const mockSignTypedData = vi.fn()

const OPERATOR_ADDRESS =
  "0xdef456def456def456def456def456def456def4" as `0x${string}`
const CALLER_ADDRESS =
  "0xabcdefabcdef1234567890abcdefabcdef12345678" as `0x${string}`
const REGISTRY_ADDRESS =
  "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1" as `0x${string}`

function makeWalletClient() {
  return {
    account: {
      address: CALLER_ADDRESS,
    },
    signTypedData: mockSignTypedData,
  } as unknown as Parameters<
    typeof createEip3009UsageReporter
  >[0]["walletClient"]
}

function makeConfig(
  overrides: Partial<Parameters<typeof createEip3009UsageReporter>[0]> = {},
) {
  return {
    walletClient: makeWalletClient(),
    chainId: 8453,
    operatorAddress: OPERATOR_ADDRESS,
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
    callerAddress: CALLER_ADDRESS,
    paid: false,
    latencyMs: 50,
    timestamp: 1748725200000,
    toolName: "My Test Tool",
    ...overrides,
  }
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch)
  mockFetch.mockResolvedValue({ ok: true })
  mockSignTypedData.mockResolvedValue(
    "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef00",
  )
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createEip3009UsageReporter", () => {
  it("sends eip3009_authorization with composite key and nested eip3009 object", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe("https://test.example.com/usage")
    expect(opts.method).toBe("POST")
    expect(opts.headers["x-api-key"]).toBe("test-api-key")
    const body = JSON.parse(opts.body as string)
    expect(body.verification_type).toBe("eip3009_authorization")
    expect(body.tool_chain_id).toBe(1)
    expect(body.tool_registry_address).toBe(REGISTRY_ADDRESS)
    expect(body.tool_onchain_id).toBe(42)
    expect(body.latency_ms).toBe(50)
    expect(body.eip3009.caller_address).toBe(CALLER_ADDRESS)
    expect(body.eip3009.chain_id).toBe(8453)
    expect(body.eip3009.from).toBe(CALLER_ADDRESS)
    expect(body.eip3009.to).toBe(OPERATOR_ADDRESS)
    expect(body.eip3009.value).toBe("0")
    expect(body.eip3009.signature).toMatch(/^0x/)
    expect(body.eip3009.nonce).toMatch(/^0x/)
    expect(body.eip3009.valid_after).toBeDefined()
    expect(body.eip3009.valid_before).toBeDefined()
    // No tool_slug in body
    expect(body.tool_slug).toBeUndefined()
  })

  it("sends x402_settlement with composite key for paid calls", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const opts = mockFetch.mock.calls[0]![1]
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

  it("does not sign for paid x402 calls", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(
      makeEvent({
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    expect(mockSignTypedData).not.toHaveBeenCalled()
  })

  it("uses default aggregator URL when not provided", async () => {
    const reporter = createEip3009UsageReporter(
      makeConfig({ aggregatorUrl: undefined }),
    )

    await reporter(makeEvent())

    const url = mockFetch.mock.calls[0]![0] as string
    expect(url).toBe("https://api.opensea.io/api/v2/tools/usage")
  })

  it("signs with caller address as from and operator address as to", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent())

    const signCallArgs = mockSignTypedData.mock.calls[0]![0]
    expect(signCallArgs.message.from).toBe(CALLER_ADDRESS)
    expect(signCallArgs.message.to).toBe(OPERATOR_ADDRESS)
  })

  it("uses custom tokenAddress when provided", async () => {
    const customToken =
      "0x1111111111111111111111111111111111111111" as `0x${string}`
    const reporter = createEip3009UsageReporter(
      makeConfig({ tokenAddress: customToken }),
    )

    await reporter(makeEvent())

    const callArgs = mockSignTypedData.mock.calls[0]![0]
    expect(callArgs.domain.verifyingContract).toBe(customToken)
  })

  it("skips reporting with warning when paid but no settlementTxHash", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent({ paid: true, settlementTxHash: undefined }))

    expect(mockFetch).not.toHaveBeenCalled()
    expect(mockSignTypedData).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("paid invocation without settlementTxHash"),
    )
    warnSpy.mockRestore()
  })

  it("logs error when response is not ok", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => "Internal Server Error",
    })

    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent())

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("eip3009 usage report failed (500)"),
    )
    errorSpy.mockRestore()
  })

  it("logs error when fetch throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent())

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

    await reporter(makeEvent())

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("sets valid_after to approximately now - 60s", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent())

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    const validAfter = Number(body.eip3009.valid_after)
    const nowSec = Math.floor(Date.now() / 1000)
    expect(validAfter).toBeGreaterThanOrEqual(nowSec - 62)
    expect(validAfter).toBeLessThanOrEqual(nowSec - 58)
  })

  it("sets valid_before to approximately now + 5min", async () => {
    const reporter = createEip3009UsageReporter(makeConfig())

    await reporter(makeEvent())

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    const validBefore = Number(body.eip3009.valid_before)
    const nowSec = Math.floor(Date.now() / 1000)
    expect(validBefore).toBeGreaterThan(nowSec)
    expect(validBefore).toBeLessThanOrEqual(nowSec + 300)
  })

  it("throws when walletClient has no account attached", () => {
    const walletClient = {
      signTypedData: mockSignTypedData,
    } as unknown as Parameters<
      typeof createEip3009UsageReporter
    >[0]["walletClient"]

    expect(() =>
      createEip3009UsageReporter(makeConfig({ walletClient })),
    ).toThrow("walletClient must have an account attached")
  })

  it("throws for invalid operatorAddress", () => {
    expect(() =>
      createEip3009UsageReporter(
        makeConfig({ operatorAddress: "not-an-address" as `0x${string}` }),
      ),
    ).toThrow("invalid operatorAddress")
  })

  it("throws for invalid toolRegistryAddress", () => {
    expect(() =>
      createEip3009UsageReporter(
        makeConfig({
          toolRegistryAddress: "0xinvalid" as `0x${string}`,
        }),
      ),
    ).toThrow("invalid toolRegistryAddress")
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

  it("throws for invalid tokenAddress when provided", () => {
    expect(() =>
      createEip3009UsageReporter(
        makeConfig({ tokenAddress: "0xbad" as `0x${string}` }),
      ),
    ).toThrow("invalid tokenAddress")
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
})
