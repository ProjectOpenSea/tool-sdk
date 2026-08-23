import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createX402UsageReporter,
  type X402UsageEvent,
  type X402UsageReporterConfig,
} from "../lib/usage/x402-reporter.js"

const REGISTRY_ADDRESS = "0x265bb2dbfc0a8165c9a1941eb1372f349bad2cf1"
const CALLER_ADDRESS =
  "0xabcdefabcdef1234567890abcdefabcdef123456" as `0x${string}`

function makeConfig(
  overrides: Partial<X402UsageReporterConfig> = {},
): X402UsageReporterConfig {
  return {
    toolChainId: 8453,
    toolRegistryAddress: REGISTRY_ADDRESS,
    toolOnchainId: 42,
    apiKey: "test-api-key",
    ...overrides,
  }
}

function makeEvent(overrides: Partial<X402UsageEvent> = {}): X402UsageEvent {
  return {
    callerAddress: CALLER_ADDRESS,
    txHash:
      "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
    chainId: 8453,
    latencyMs: 100,
    ...overrides,
  }
}

describe("createX402UsageReporter", () => {
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
    const report = createX402UsageReporter(makeConfig())
    await report(makeEvent())

    expect(fetchSpy).toHaveBeenCalledOnce()
    const [url, opts] = fetchSpy.mock.calls[0]!
    expect(url).toBe("https://api.opensea.io/api/v2/tools/usage")
    expect(opts.headers["x-api-key"]).toBe("test-api-key")

    const body = JSON.parse(opts.body)
    expect(body).toEqual({
      verification_type: "x402_settlement",
      tool_chain_id: 8453,
      tool_registry_address: REGISTRY_ADDRESS,
      tool_onchain_id: 42,
      latency_ms: 100,
      x402: {
        caller_address: CALLER_ADDRESS,
        tx_hash:
          "0xabc123def456abc123def456abc123def456abc123def456abc123def456abc1",
        chain_id: 8453,
      },
    })
  })

  it("uses custom aggregatorUrl when provided", async () => {
    const report = createX402UsageReporter(
      makeConfig({ aggregatorUrl: "https://custom.endpoint/usage" }),
    )
    await report(makeEvent())

    const [url] = fetchSpy.mock.calls[0]!
    expect(url).toBe("https://custom.endpoint/usage")
  })

  it("omits latency_ms when not provided", async () => {
    const report = createX402UsageReporter(makeConfig())
    await report(makeEvent({ latencyMs: undefined }))

    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    expect(body.latency_ms).toBeUndefined()
  })

  it("logs error on non-OK response without throwing", async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response("Unauthorized", { status: 401 }),
    )
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const report = createX402UsageReporter(makeConfig())
    await report(makeEvent())

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("x402 usage report failed (401)"),
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

    const report = createX402UsageReporter(makeConfig({ timeoutMs: 1 }))
    await report(makeEvent())

    expect(consoleSpy).not.toHaveBeenCalled()
  })

  it("accepts x402:bazaar registry and string onchainId", async () => {
    const report = createX402UsageReporter(
      makeConfig({
        toolRegistryAddress: "x402:bazaar",
        toolOnchainId: "8679018179619845322",
      }),
    )
    await report(makeEvent())

    expect(fetchSpy).toHaveBeenCalledOnce()
    const body = JSON.parse(fetchSpy.mock.calls[0]![1].body)
    expect(body.tool_registry_address).toBe("x402:bazaar")
    expect(body.tool_onchain_id).toBe("8679018179619845322")
  })

  // Validation tests
  it("throws for empty toolRegistryAddress", () => {
    expect(() =>
      createX402UsageReporter(makeConfig({ toolRegistryAddress: "" })),
    ).toThrow("toolRegistryAddress must not be empty")
  })

  it("throws for negative toolOnchainId", () => {
    expect(() =>
      createX402UsageReporter(makeConfig({ toolOnchainId: -1 })),
    ).toThrow("toolOnchainId must be a non-negative integer")
  })

  it("throws for non-positive toolChainId", () => {
    expect(() =>
      createX402UsageReporter(makeConfig({ toolChainId: 0 })),
    ).toThrow("toolChainId must be a positive integer")
  })

  it("throws for empty apiKey", () => {
    expect(() => createX402UsageReporter(makeConfig({ apiKey: "" }))).toThrow(
      "apiKey is required",
    )
  })

  it("logs error and skips fetch for malformed txHash", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const report = createX402UsageReporter(makeConfig())
    await report(makeEvent({ txHash: "0xshort" }))

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid txHash"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("logs error and skips fetch for invalid callerAddress", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const report = createX402UsageReporter(makeConfig())
    await report(
      makeEvent({ callerAddress: "not-an-address" as `0x${string}` }),
    )

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("invalid callerAddress"),
    )
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  // The report carries `x-api-key`. reportCallerX402Usage has refused a
  // plaintext aggregatorUrl since it was written; this reporter posts the same
  // header to the same config field and did not.
  it("refuses to send over an insecure http aggregatorUrl", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const report = createX402UsageReporter(
      makeConfig({ aggregatorUrl: "http://evil.example/usage" }),
    )
    await report(makeEvent())

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("insecure aggregatorUrl"),
    )
  })

  it("allows http://localhost for local dev", async () => {
    const report = createX402UsageReporter(
      makeConfig({ aggregatorUrl: "http://localhost:3000/usage" }),
    )
    await report(makeEvent())

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(fetchSpy.mock.calls[0]![0]).toBe("http://localhost:3000/usage")
  })
})
