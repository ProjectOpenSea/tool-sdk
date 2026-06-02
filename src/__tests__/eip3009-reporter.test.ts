import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEip3009UsageReporter } from "../lib/usage/eip3009-reporter.js"
import type { InvocationEvent } from "../types.js"

const mockFetch = vi.fn()
const mockSignTypedData = vi.fn()

function makeWalletClient() {
  return {
    account: {
      address: "0xabcdefabcdef1234567890abcdefabcdef12345678",
    },
    signTypedData: mockSignTypedData,
  } as unknown as Parameters<
    typeof createEip3009UsageReporter
  >[0]["walletClient"]
}

function makeEvent(overrides: Partial<InvocationEvent> = {}): InvocationEvent {
  return {
    callerAddress: "0xabcdefabcdef1234567890abcdefabcdef12345678",
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
  it("sends eip3009_authorization for free calls", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent())

    expect(mockFetch).toHaveBeenCalledOnce()
    const [url, opts] = mockFetch.mock.calls[0]!
    expect(url).toBe("https://test.example.com/usage")
    expect(opts.method).toBe("POST")
    const body = JSON.parse(opts.body as string)
    expect(body.verification_type).toBe("eip3009_authorization")
    expect(body.caller_address).toBe(
      "0xabcdefabcdef1234567890abcdefabcdef12345678",
    )
    expect(body.tool_slug).toBe("my-test-tool")
    expect(body.chain_id).toBe(8453)
    expect(body.value).toBe("0")
    expect(body.valid_after).toBe("0")
    expect(body.signature).toMatch(/^0x/)
    expect(body.nonce).toMatch(/^0x/)
    expect(body.latency_ms).toBe(50)
  })

  it("sends x402_settlement for paid calls with settlementTxHash", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(
      makeEvent({
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    expect(mockFetch).toHaveBeenCalledOnce()
    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.verification_type).toBe("x402_settlement")
    expect(body.tx_hash).toBe("0xtxhash123")
    expect(body.caller_address).toBe(
      "0xabcdefabcdef1234567890abcdefabcdef12345678",
    )
    expect(body.tool_slug).toBe("my-test-tool")
    expect(body.latency_ms).toBe(50)
    expect(body.signature).toBeUndefined()
  })

  it("does not sign for paid x402 calls", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
    })

    await reporter(
      makeEvent({
        paid: true,
        settlementTxHash: "0xtxhash123",
      }),
    )

    expect(mockSignTypedData).not.toHaveBeenCalled()
  })

  it("uses default aggregator URL when not provided", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
    })

    await reporter(makeEvent())

    const url = mockFetch.mock.calls[0]![0] as string
    expect(url).toBe("https://api.opensea.io/api/v2/agent-tools/usage")
  })

  it("uses explicit toolSlug over derived name", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      toolSlug: "custom-slug",
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent())

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.tool_slug).toBe("custom-slug")
  })

  it("derives tool_slug from toolName", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent({ toolName: "My Cool Tool" }))

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.tool_slug).toBe("my-cool-tool")
  })

  it("uses custom tokenAddress when provided", async () => {
    const customToken =
      "0x1111111111111111111111111111111111111111" as `0x${string}`
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      tokenAddress: customToken,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent())

    const callArgs = mockSignTypedData.mock.calls[0]![0]
    expect(callArgs.domain.verifyingContract).toBe(customToken)
  })

  it("skips reporting with warning when paid but no settlementTxHash", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

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

    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent())

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("eip3009 usage report failed (500)"),
    )
    errorSpy.mockRestore()
  })

  it("logs error when fetch throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    mockFetch.mockRejectedValueOnce(new Error("network down"))

    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

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

    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent())

    expect(errorSpy).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("falls back to wallet account address when callerAddress is missing", async () => {
    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent({ callerAddress: undefined }))

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.caller_address).toBe(
      "0xabcdefabcdef1234567890abcdefabcdef12345678",
    )
  })

  it("signs with operator address (walletClient) even when callerAddress differs", async () => {
    const operatorAddress =
      "0xabcdefabcdef1234567890abcdefabcdef12345678" as const
    const callerAddress =
      "0x1111111111111111111111111111111111111111" as `0x${string}`

    const reporter = createEip3009UsageReporter({
      walletClient: makeWalletClient(),
      chainId: 8453,
      aggregatorUrl: "https://test.example.com/usage",
    })

    await reporter(makeEvent({ callerAddress }))

    const signCallArgs = mockSignTypedData.mock.calls[0]![0]
    expect(signCallArgs.message.from).toBe(operatorAddress)

    const body = JSON.parse(mockFetch.mock.calls[0]![1].body as string)
    expect(body.caller_address).toBe(callerAddress)
    expect(body.from).toBe(operatorAddress)
  })
})
