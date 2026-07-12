import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../types.js"

const TEST_PREDICATE =
  "0xpredicatepredicatepredicatepredicatepredi" as `0x${string}`
const TEST_CALLER = "0xabcdefabcdef1234567890abcdefabcdef123456" as const
const TEST_TOOL_ID = 42n
const TEST_OPERATOR =
  "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`

const mockTryHasAccess = vi.fn(async () => ({ ok: true, granted: true }))
const mockGetToolConfig = vi.fn(async () => ({
  creator: "0xcreatorcreatorcreatorcreatorcreatorcreator",
  metadataURI: "https://example.com/manifest.json",
  manifestHash: "0x0",
  accessPredicate: TEST_PREDICATE,
}))

const mockConstructorArgs = vi.fn()

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    tryHasAccess = mockTryHasAccess
    getToolConfig = mockGetToolConfig
    constructor(config: Record<string, unknown>) {
      mockConstructorArgs(config)
    }
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

beforeEach(() => {
  mockTryHasAccess.mockReset()
  mockTryHasAccess.mockResolvedValue({ ok: true, granted: true })
  mockGetToolConfig.mockReset()
  mockGetToolConfig.mockResolvedValue({
    creator: "0xcreatorcreatorcreatorcreatorcreatorcreator",
    metadataURI: "https://example.com/manifest.json",
    manifestHash: "0x0",
    accessPredicate: TEST_PREDICATE,
  })
  mockConstructorArgs.mockReset()
  mockRecoverTypedDataAddress.mockReset()
  mockRecoverTypedDataAddress.mockResolvedValue(TEST_CALLER as `0x${string}`)
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeXPaymentHeader(
  overrides: Record<string, unknown> = {},
  network = "base",
): string {
  const authorization = {
    from: TEST_CALLER,
    to: TEST_OPERATOR,
    value: "0",
    validAfter: "0",
    validBefore: String(Math.floor(Date.now() / 1000) + 300),
    nonce: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
    ...overrides,
  }
  const payload = {
    x402Version: 1,
    scheme: "exact",
    network,
    payload: {
      signature: "0xabcd",
      authorization,
    },
  }
  return Buffer.from(JSON.stringify(payload)).toString("base64")
}

function makeAuthorizedRequest(
  headerOverrides: Record<string, unknown> = {},
): Request {
  return new Request("https://example.com/api", {
    method: "POST",
    headers: { "X-Payment": makeXPaymentHeader(headerOverrides) },
  })
}

describe("predicateGate", () => {
  it("returns 402 challenge when X-Payment header is missing", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const request = new Request("https://example.com/api", {
      method: "POST",
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.x402Version).toBe(1)
    expect(body.accepts).toHaveLength(1)
    expect(body.accepts[0].payTo).toBe(TEST_OPERATOR)
    expect(body.accepts[0].maxAmountRequired).toBe("0")
    expect(body.accepts[0].scheme).toBe("exact")
    expect(body.accepts[0].network).toBe("base")
  })

  it("returns 402 with base-sepolia network when chain is baseSepolia", async () => {
    const { baseSepolia } = await import("viem/chains")
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      chain: baseSepolia,
    })
    const request = new Request("https://example.com/api", { method: "POST" })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.accepts[0].network).toBe("base-sepolia")
    expect(body.accepts[0].asset).toBe(
      "0x036cbd53842c5426634e7929541ec2318f3dcf7e",
    )
  })

  it("passes and sets ctx.callerAddress when tryHasAccess returns (true, true)", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.gates?.predicate).toEqual({ granted: true })
    expect(ctx.callerAuthorization).toMatchObject({
      from: TEST_CALLER,
      value: "0",
      signature: "0xabcd",
      chainId: 8453,
    })
    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      TEST_CALLER,
      "0x",
    )
  })

  it("accepts a CAIP-2 network (eip155:8453) in the X-Payment payload", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader({}, "eip155:8453") },
    })
    const response = await gate.check(request, ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.callerAuthorization).toMatchObject({ chainId: 8453 })
  })

  it("accepts a numeric network (8453) in the X-Payment payload", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader({}, "8453") },
    })
    const response = await gate.check(request, ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.callerAuthorization).toMatchObject({ chainId: 8453 })
  })

  it("returns 401 for a genuinely unsupported network in the X-Payment payload", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader({}, "eip155:1") },
    })
    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/unsupported network/i)
  })

  it("returns 403 with predicate address when tryHasAccess returns (true, false)", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(403)
    const body = await response?.json()
    expect(body.error).toMatch(/access predicate denied/i)
    expect(body.predicate).toBe(TEST_PREDICATE)
    expect(ctx.callerAddress).toBeUndefined()
  })

  it("returns 502 when tryHasAccess returns (false, *) (predicate misbehaved)", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: false, granted: false })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toMatch(/predicate misbehaved/i)
  })

  it("forwards the configured `data` argument to tryHasAccess", async () => {
    const customData = "0xdeadbeef" as const
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      data: customData,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    await gate.check(makeAuthorizedRequest(), ctx)

    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      TEST_CALLER,
      customData,
    )
  })

  it("returns 502 when registry.tryHasAccess throws (RPC failure)", async () => {
    mockTryHasAccess.mockRejectedValueOnce(new Error("RPC timeout"))
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toMatch(/registry/i)
    expect(ctx.callerAddress).toBeUndefined()
  })

  it("refreshes the cached predicate address after the TTL elapses", async () => {
    const OLD = "0x0000000000000000000000000000000000000001" as const
    const NEW = "0x0000000000000000000000000000000000000002" as const

    mockGetToolConfig.mockReset()
    mockGetToolConfig
      .mockResolvedValueOnce({
        creator: "0xcreatorcreatorcreatorcreatorcreatorcreator",
        metadataURI: "https://example.com/manifest.json",
        manifestHash: "0x0",
        accessPredicate: OLD,
      })
      .mockResolvedValueOnce({
        creator: "0xcreatorcreatorcreatorcreatorcreatorcreator",
        metadataURI: "https://example.com/manifest.json",
        manifestHash: "0x0",
        accessPredicate: NEW,
      })

    vi.useFakeTimers()
    try {
      const { predicateGate } = await import(
        "../lib/middleware/predicate-gate.js"
      )
      const gate = predicateGate({
        toolId: TEST_TOOL_ID,
        operatorAddress: TEST_OPERATOR,
      })

      // First denial: cache populates with OLD.
      mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
      let response = await gate.check(makeAuthorizedRequest(), { gates: {} })
      expect(response?.status).toBe(403)
      let body = await response?.json()
      expect(body.predicate).toBe(OLD)
      expect(mockGetToolConfig).toHaveBeenCalledTimes(1)

      // Within TTL: cache hits, no refresh.
      vi.advanceTimersByTime(4 * 60 * 1000)
      mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
      response = await gate.check(makeAuthorizedRequest(), { gates: {} })
      body = await response?.json()
      expect(body.predicate).toBe(OLD)
      expect(mockGetToolConfig).toHaveBeenCalledTimes(1)

      // After TTL: cache refreshes to NEW.
      vi.advanceTimersByTime(2 * 60 * 1000)
      mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
      response = await gate.check(makeAuthorizedRequest(), { gates: {} })
      body = await response?.json()
      expect(body.predicate).toBe(NEW)
      expect(mockGetToolConfig).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it("passes registryAddress to ToolRegistryClient when provided", async () => {
    const customRegistry =
      "0x1234567890abcdef1234567890abcdef12345678" as `0x${string}`
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      registryAddress: customRegistry,
    })

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ registryAddress: customRegistry }),
    )
  })

  it("does not pass a concrete registryAddress when omitted", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    predicateGate({ toolId: TEST_TOOL_ID, operatorAddress: TEST_OPERATOR })

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.not.objectContaining({
        registryAddress: expect.any(String),
      }),
    )
  })

  // -------------------------------------------------------------------------
  // X-Payment validation
  // -------------------------------------------------------------------------

  it("X-Payment: rejects an authorization that omits validBefore", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const header = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: "base",
        payload: {
          signature: "0xabcd",
          authorization: {
            from: TEST_CALLER,
            to: TEST_OPERATOR,
            value: "0",
            validAfter: "0",
            // validBefore intentionally omitted
            nonce:
              "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          },
        },
      }),
    ).toString("base64")
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": header },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/missing required authorization fields/i)
  })

  it("X-Payment: returns 400 for unsupported x402Version", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const badVersionPayload = Buffer.from(
      JSON.stringify({
        x402Version: 2,
        scheme: "exact",
        network: "base",
        payload: {
          signature: "0xabcd",
          authorization: {
            from: TEST_CALLER,
            to: TEST_OPERATOR,
            value: "0",
            validAfter: "0",
            validBefore: String(Math.floor(Date.now() / 1000) + 300),
            nonce:
              "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
          },
        },
      }),
    ).toString("base64")
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": badVersionPayload },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toMatch(/unsupported x402 version/i)
  })

  it("X-Payment: returns 401 when to-mismatch with operatorAddress", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress:
        "0x1111111111111111111111111111111111111111" as `0x${string}`,
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
  })

  it("X-Payment: returns 401 when authorization is expired", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeAuthorizedRequest({
        validBefore: String(Math.floor(Date.now() / 1000) - 60),
      }),
      ctx,
    )

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/expired/i)
  })

  it("X-Payment: returns 401 when authorization is not yet valid", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeAuthorizedRequest({
        validAfter: String(Math.floor(Date.now() / 1000) + 3600),
      }),
      ctx,
    )

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/not yet valid/i)
  })

  it("X-Payment: returns 401 when signature recovery fails", async () => {
    mockRecoverTypedDataAddress.mockRejectedValueOnce(
      new Error("bad signature"),
    )
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/invalid.*signature/i)
  })

  it("X-Payment: returns 401 when recovered address does not match 'from'", async () => {
    mockRecoverTypedDataAddress.mockResolvedValueOnce(
      "0x9999999999999999999999999999999999999999" as `0x${string}`,
    )
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/signer does not match/i)
  })

  // -------------------------------------------------------------------------
  // Security hardening (audit findings)
  // -------------------------------------------------------------------------

  it("X-Payment: rejects a non-zero-value authorization on the free identity gate", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeAuthorizedRequest({ value: "1000000" }),
      ctx,
    )

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/zero-value/i)
    expect(ctx.callerAddress).toBeUndefined()
    expect(mockTryHasAccess).not.toHaveBeenCalled()
  })

  it("X-Payment: rejects a validBefore more than 1 hour in the future", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeAuthorizedRequest({
        validBefore: String(Math.floor(Date.now() / 1000) + 7200),
      }),
      ctx,
    )

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/too far in the future/i)
    expect(ctx.callerAddress).toBeUndefined()
  })

  it("X-Payment: accepts a validBefore exactly at the 1 hour boundary", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    // Exactly now + 3600s must pass (the cap rejects only when strictly greater).
    const response = await gate.check(
      makeAuthorizedRequest({
        validBefore: String(Math.floor(Date.now() / 1000) + 3600),
      }),
      ctx,
    )

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
  })

  it("X-Payment: rejects an authorization signed for a different chain", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    // Gate defaults to Base mainnet (8453); authorization declares base-sepolia.
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": makeXPaymentHeader({}, "base-sepolia") },
    })
    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/network mismatch/i)
    expect(ctx.callerAddress).toBeUndefined()
  })

  it("verifies a Base-signed identity against a non-Base registry chain", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { mainnet } = await import("viem/chains")
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    // Registry on Ethereum mainnet, identity proof on Base USDC. The identity
    // chain must not be pinned to the registry chain, or every caller fails
    // closed and operators fall back to the leaky Base default.
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      chain: mainnet,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    // Reads follow the configured chain (undefined rpcUrl → viem chain default),
    // not a hardcoded Base RPC.
    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ chain: mainnet, rpcUrl: undefined }),
    )
  })

  it("advertises network=base in the 402 challenge for a non-Base registry chain", async () => {
    const { mainnet } = await import("viem/chains")
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: TEST_OPERATOR,
      chain: mainnet,
    })
    const request = new Request("https://example.com/api", { method: "POST" })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.accepts[0].network).toBe("base")
  })

  it("X-Payment: fails closed with 500 when operatorAddress is unset", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      // Simulate a misconfiguration that reaches verification at runtime.
      operatorAddress: undefined as unknown as `0x${string}`,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeAuthorizedRequest({ to: TEST_OPERATOR }),
      ctx,
    )

    expect(response?.status).toBe(500)
    const body = await response?.json()
    expect(body.error).toMatch(/operator address is not configured/i)
    expect(ctx.callerAddress).toBeUndefined()
  })
})
