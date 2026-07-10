import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../types.js"

const TEST_CALLER = "0xabcdefabcdef1234567890abcdefabcdef123456" as const
const TEST_TOOL_ID = 42n
const TEST_OPERATOR =
  "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
const TEST_PREDICATE =
  "0xpredicatepredicatepredicatepredicatepredi" as `0x${string}`

const mockTryHasAccess = vi.fn(async () => ({ ok: true, granted: true }))
const mockGetToolConfig = vi.fn(async () => ({
  creator: TEST_OPERATOR,
  metadataURI: "https://example.com/manifest.json",
  manifestHash: "0x0",
  accessPredicate: TEST_PREDICATE,
}))

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    tryHasAccess = mockTryHasAccess
    getToolConfig = mockGetToolConfig
  },
}))

const mockRecoverTypedDataAddress = vi
  .fn()
  .mockResolvedValue(TEST_CALLER as `0x${string}`)

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: vi.fn().mockResolvedValue(true),
    }),
    recoverTypedDataAddress: (...args: unknown[]) =>
      mockRecoverTypedDataAddress(...args),
  }
})

const mockFetch = vi.fn()

beforeEach(() => {
  mockTryHasAccess.mockReset()
  mockTryHasAccess.mockResolvedValue({ ok: true, granted: true })
  mockGetToolConfig.mockReset()
  mockGetToolConfig.mockResolvedValue({
    creator: TEST_OPERATOR,
    metadataURI: "https://example.com/manifest.json",
    manifestHash: "0x0",
    accessPredicate: TEST_PREDICATE,
  })
  mockRecoverTypedDataAddress.mockReset()
  mockRecoverTypedDataAddress.mockResolvedValue(TEST_CALLER as `0x${string}`)
  mockFetch.mockReset()
  vi.stubGlobal("fetch", mockFetch)
})

afterEach(() => {
  vi.clearAllMocks()
  vi.unstubAllGlobals()
})

function makeXPaymentHeader(overrides: Record<string, unknown> = {}): string {
  const authorization = {
    from: TEST_CALLER,
    to: TEST_OPERATOR,
    value: "1000000",
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 300),
    nonce: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    ...overrides,
  }
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network: "base",
    payload: {
      signature: "0xabcd",
      authorization,
    },
  }
  return Buffer.from(JSON.stringify(payload)).toString("base64")
}

function mockFacilitatorVerifySuccess() {
  mockFetch.mockResolvedValueOnce(
    new Response(JSON.stringify({ isValid: true, payer: TEST_CALLER }), {
      status: 200,
    }),
  )
}

function mockFacilitatorSettleSuccess(network = "base") {
  mockFetch.mockResolvedValueOnce(
    new Response(
      JSON.stringify({
        success: true,
        transaction: "0xtxhash123",
        network,
      }),
      { status: 200 },
    ),
  )
}

describe("paidPredicateGate", () => {
  it("returns 402 with real payment amount when no X-Payment", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.x402Version).toBe(1)
    expect(body.accepts[0].maxAmountRequired).toBe("1000000")
    expect(body.accepts[0].payTo).toBe(TEST_OPERATOR)
    expect(body.accepts[0].scheme).toBe("exact")
    expect(body.accepts[0].network).toBe("base")
  })

  it("succeeds when X-Payment valid + predicate passes + facilitator verifies", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockFacilitatorVerifySuccess()
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.gates?.predicate).toEqual({ granted: true })
    expect(ctx.gates?.x402).toEqual({ paid: true, payer: TEST_CALLER })
  })

  it("returns 403 when predicate denies access (no payment settled)", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(403)
    const body = await response?.json()
    expect(body.error).toMatch(/access predicate denied/i)
    // Facilitator should NOT have been called
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("returns 401 when X-Payment to-address mismatches operatorAddress", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress:
        "0x1111111111111111111111111111111111111111" as `0x${string}`,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: {
        "X-Payment": makeXPaymentHeader({
          to: "0x2222222222222222222222222222222222222222",
        }),
      },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/address mismatch/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("accepts a non-zero-value authorization (paid gate must not enforce zero-value)", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockFacilitatorVerifySuccess()
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      // Explicit non-zero value — the identity-gate zero-value rule must NOT
      // apply here since the facilitator settles the payment.
      headers: { "X-Payment": makeXPaymentHeader({ value: "1000000" }) },
    })

    const response = await gate.check(request, ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.gates?.x402).toEqual({ paid: true, payer: TEST_CALLER })
  })

  it("returns 401 when X-Payment is signed for a different chain", async () => {
    const { baseSepolia } = await import("viem/chains")
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    // Gate configured for base-sepolia; authorization declares base mainnet.
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
      chain: baseSepolia,
      network: "base-sepolia",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/network mismatch/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("fails closed with 500 when operatorAddress is unset", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    // The paid gate shares verifyXPaymentAuth (requireZeroValue: false), so the
    // fail-closed operator guard must also apply here.
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: undefined as unknown as `0x${string}`,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(500)
    const body = await response?.json()
    expect(body.error).toMatch(/operator address is not configured/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("returns 502 when facilitator /verify is unreachable", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockFetch.mockRejectedValueOnce(new Error("network error"))
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toMatch(/facilitator unreachable/i)
  })

  it("returns 402 when facilitator says payment is invalid", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ isValid: false, invalidReason: "insufficient_funds" }),
        { status: 200 },
      ),
    )
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.error).toBe("insufficient_funds")
  })

  it("settle() calls facilitator /settle and sets settlementTxHash", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockFacilitatorVerifySuccess()
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    // check() stashes the payment payload
    const response = await gate.check(request, ctx)
    expect(response).toBeNull()

    // settle() calls facilitator
    mockFacilitatorSettleSuccess()
    await gate.settle!(ctx as ToolContext)

    expect(ctx.gates?.x402?.settlementTxHash).toBe("0xtxhash123")
    expect(ctx.gates?.x402?.settlementChainId).toBe(8453)
    // verify was called once, settle was called once
    expect(mockFetch).toHaveBeenCalledTimes(2)
    const settleCall = mockFetch.mock.calls[1]
    expect(settleCall[0]).toContain("/settle")
  })

  it("resolves settlementChainId from a CAIP-2 facilitator network", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockFacilitatorVerifySuccess()
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)
    expect(response).toBeNull()

    // Facilitator reports the CAIP-2 network form; the usage-reporting
    // chain id must still resolve so downstream reporters get a numeric id.
    mockFacilitatorSettleSuccess("eip155:8453")
    await gate.settle!(ctx as ToolContext)

    expect(ctx.gates?.x402?.settlementTxHash).toBe("0xtxhash123")
    expect(ctx.gates?.x402?.settlementChainId).toBe(8453)
  })

  it("returns 502 when registry call fails", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockTryHasAccess.mockRejectedValueOnce(new Error("rpc error"))
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toMatch(/registry call failed/i)
    expect(mockFetch).not.toHaveBeenCalled()
  })

  it("throws on construction when facilitator=cdp without createAuthHeaders", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    expect(() =>
      paidPredicateGate({
        toolId: TEST_TOOL_ID,
        operatorAddress: TEST_OPERATOR,
        amountUsdc: "1.00",
        facilitator: "cdp",
      }),
    ).toThrow(/createAuthHeaders is required/i)
  })

  it("uses base-sepolia network when configured", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "0.50",
      network: "base-sepolia",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.accepts[0].network).toBe("base-sepolia")
    expect(body.accepts[0].maxAmountRequired).toBe("500000")
  })

  it("converts decimal amountUsdc to base units correctly", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "0.01",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
    })

    const response = await gate.check(request, ctx)

    const body = await response?.json()
    expect(body.accepts[0].maxAmountRequired).toBe("10000")
  })

  it("predicate is checked BEFORE facilitator (safety invariant)", async () => {
    const { paidPredicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
    const gate = paidPredicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      amountUsdc: "1.00",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader() },
    })

    const response = await gate.check(request, ctx)

    // Predicate denied → 403, facilitator never called
    expect(response?.status).toBe(403)
    expect(mockFetch).not.toHaveBeenCalled()
  })
})
