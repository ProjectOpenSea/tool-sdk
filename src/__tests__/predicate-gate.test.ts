import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../types.js"

const TEST_PREDICATE =
  "0xpredicatepredicatepredicatepredicatepredi" as `0x${string}`
const TEST_CALLER = "0xabcdefabcdef1234567890abcdefabcdef123456" as const
const TEST_TOOL_ID = 42n

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
      verifySiweMessage: vi.fn().mockResolvedValue(true),
    }),
    recoverTypedDataAddress: (...args: unknown[]) =>
      mockRecoverTypedDataAddress(...args),
  }
})

vi.mock("viem/siwe", () => ({
  parseSiweMessage: vi.fn().mockReturnValue({
    address: TEST_CALLER,
    domain: "example.com",
    uri: "https://example.com",
    version: "1",
    chainId: 8453,
    nonce: "testnonce",
    issuedAt: new Date(),
  }),
}))

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

function makeAuthorizedRequest() {
  const message = Buffer.from("example.com wants you to sign in").toString(
    "base64url",
  )
  return new Request("https://example.com/api", {
    method: "POST",
    headers: { Authorization: `SIWE ${message}.0xdeadbeef` },
  })
}

describe("predicateGate", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const request = new Request("https://example.com/api", {
      method: "POST",
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toContain("authorization required")
  })

  it("returns 401 when Authorization scheme is not SIWE", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
  })

  it("returns 401 when SIWE token has no dot separator", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: "SIWE nodot" },
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
  })

  it("returns 401 when SIWE domain does not match request host", async () => {
    const { parseSiweMessage } = await import("viem/siwe")
    vi.mocked(parseSiweMessage).mockReturnValueOnce({
      address: TEST_CALLER,
      domain: "other.example",
      uri: "https://other.example",
      version: "1",
      chainId: 8453,
      nonce: "testnonce",
      issuedAt: new Date(),
      scheme: undefined,
      statement: undefined,
      expirationTime: undefined,
      notBefore: undefined,
      requestId: undefined,
      resources: undefined,
    })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toContain("domain mismatch")
  })

  it("returns 401 when SIWE message is expired", async () => {
    const { parseSiweMessage } = await import("viem/siwe")
    vi.mocked(parseSiweMessage).mockReturnValueOnce({
      address: TEST_CALLER,
      domain: "example.com",
      uri: "https://example.com",
      version: "1",
      chainId: 8453,
      nonce: "testnonce",
      issuedAt: new Date(),
      scheme: undefined,
      statement: undefined,
      expirationTime: new Date(Date.now() - 60_000),
      notBefore: undefined,
      requestId: undefined,
      resources: undefined,
    })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/expired/i)
  })

  it("returns 401 when SIWE message is not yet valid", async () => {
    const { parseSiweMessage } = await import("viem/siwe")
    vi.mocked(parseSiweMessage).mockReturnValueOnce({
      address: TEST_CALLER,
      domain: "example.com",
      uri: "https://example.com",
      version: "1",
      chainId: 8453,
      nonce: "testnonce",
      issuedAt: new Date(),
      scheme: undefined,
      statement: undefined,
      expirationTime: undefined,
      notBefore: new Date(Date.now() + 60_000),
      requestId: undefined,
      resources: undefined,
    })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/not yet valid/i)
  })

  it("passes and sets ctx.callerAddress when tryHasAccess returns (true, true)", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeAuthorizedRequest(), ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.gates?.predicate).toEqual({ granted: true })
    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      TEST_CALLER,
      "0x",
    )
  })

  it("returns 403 with predicate address when tryHasAccess returns (true, false)", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
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
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
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
    const gate = predicateGate({ toolId: TEST_TOOL_ID, data: customData })
    const ctx: Partial<ToolContext> = { gates: {} }

    await gate.check(makeAuthorizedRequest(), ctx)

    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      TEST_CALLER,
      customData,
    )
  })

  it("returns 401 when the SIWE signature does not start with 0x", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const message = Buffer.from("example.com wants you to sign in").toString(
      "base64url",
    )
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `SIWE ${message}.notHex` },
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/invalid SIWE signature/i)
    expect(mockTryHasAccess).not.toHaveBeenCalled()
  })

  it("returns 502 when registry.tryHasAccess throws (RPC failure)", async () => {
    mockTryHasAccess.mockRejectedValueOnce(new Error("RPC timeout"))
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
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
      const gate = predicateGate({ toolId: TEST_TOOL_ID })

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
    predicateGate({ toolId: TEST_TOOL_ID, registryAddress: customRegistry })

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.objectContaining({ registryAddress: customRegistry }),
    )
  })

  it("does not pass a concrete registryAddress when omitted", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    predicateGate({ toolId: TEST_TOOL_ID })

    expect(mockConstructorArgs).toHaveBeenCalledWith(
      expect.not.objectContaining({
        registryAddress: expect.any(String),
      }),
    )
  })

  // -------------------------------------------------------------------------
  // EIP-3009 auth path
  // -------------------------------------------------------------------------

  function makeEip3009Token(overrides: Record<string, unknown> = {}) {
    const payload = {
      from: TEST_CALLER,
      to: "0x0000000000000000000000000000000000000000",
      value: "0",
      validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + 300),
      nonce:
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      signature: "0xabcd",
      chainId: 8453,
      ...overrides,
    }
    const json = JSON.stringify(payload)
    const encoded = btoa(json)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
    return encoded
  }

  function makeEip3009Request(overrides: Record<string, unknown> = {}) {
    const token = makeEip3009Token(overrides)
    return new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `EIP-3009 ${token}` },
    })
  }

  it("EIP-3009: succeeds and sets callerAddress", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeEip3009Request(), ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
    expect(ctx.gates?.predicate).toEqual({ granted: true })
    // The verified authorization is stashed so usage reporting can forward
    // the caller's own signature instead of re-signing server-side.
    expect(ctx.callerAuthorization).toMatchObject({
      from: TEST_CALLER,
      value: "0",
      signature: "0xabcd",
      chainId: 8453,
    })
  })

  it("EIP-3009: returns 401 when required fields are missing (no 'to')", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const token = makeEip3009Token()
    const payload = JSON.parse(
      atob(token.replace(/-/g, "+").replace(/_/g, "/")),
    )
    delete payload.to
    const badJson = JSON.stringify(payload)
    const badToken = btoa(badJson)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `EIP-3009 ${badToken}` },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/missing required fields/i)
  })

  it("EIP-3009: returns 401 when validBefore is missing", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    // Omitting validBefore must be rejected at the required-field guard with a
    // clear error, matching the X-Payment path. Without the guard the request
    // is only incidentally rejected (BigInt(undefined) throws during recovery,
    // surfacing as "invalid signature"); a future `?? "0"` fallback would let
    // an unbounded proof through, so the field must be explicitly required.
    const token = makeEip3009Token()
    const payload = JSON.parse(
      atob(token.replace(/-/g, "+").replace(/_/g, "/")),
    )
    delete payload.validBefore
    const badToken = btoa(JSON.stringify(payload))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=/g, "")
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `EIP-3009 ${badToken}` },
    })

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/missing required fields/i)
  })

  it("EIP-3009: returns 401 when value !== '0'", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeEip3009Request({ value: "100" }), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/value=0/i)
  })

  it("EIP-3009: returns 402 with PaymentRequirements when operatorAddress mismatches 'to'", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x1111111111111111111111111111111111111111" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeEip3009Request({
        to: "0x2222222222222222222222222222222222222222",
      }),
      ctx,
    )

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.accepts).toHaveLength(1)
    expect(body.accepts[0].payTo).toBe(operator)
    expect(body.accepts[0].maxAmountRequired).toBe("0")
  })

  it("returns 402 with PaymentRequirements when operatorAddress is configured (no auth)", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
    })
    const request = new Request("https://example.com/api", { method: "POST" })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.x402Version).toBe(1)
    expect(body.accepts).toHaveLength(1)
    expect(body.accepts[0].payTo).toBe(operator)
    expect(body.accepts[0].maxAmountRequired).toBe("0")
    expect(body.accepts[0].scheme).toBe("exact")
    expect(body.accepts[0].network).toBe("base")
  })

  it("returns 402 with base-sepolia network when chain is baseSepolia", async () => {
    const { baseSepolia } = await import("viem/chains")
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
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

  it("returns 402 with PaymentRequirements on EIP-3009 to-mismatch", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x1111111111111111111111111111111111111111" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeEip3009Request({
        to: "0x2222222222222222222222222222222222222222",
      }),
      ctx,
    )

    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.accepts).toHaveLength(1)
    expect(body.accepts[0].payTo).toBe(operator)
    expect(body.accepts[0].maxAmountRequired).toBe("0")
  })

  it("returns 401 without accepts when operatorAddress is not configured (no auth)", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const request = new Request("https://example.com/api", { method: "POST" })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(request, ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.accepts).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // X-Payment auth path (unified x402 flow)
  // -------------------------------------------------------------------------

  function makeXPaymentHeader(overrides: Record<string, unknown> = {}): string {
    const authorization = {
      from: TEST_CALLER,
      to: "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8",
      value: "0",
      validAfter: "0",
      validBefore: String(Math.floor(Date.now() / 1000) + 300),
      nonce:
        "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
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

  it("X-Payment: succeeds and sets callerAddress", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
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
    expect(ctx.callerAuthorization).toMatchObject({
      from: TEST_CALLER,
      value: "0",
      signature: "0xabcd",
      chainId: 8453,
    })
  })

  it("X-Payment: rejects an authorization that omits validBefore", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    // Authorization with NO validBefore. The signer (recovery mock -> TEST_CALLER)
    // matches `from`, so the expiry check is the only bound on this token. When
    // validBefore is absent that check is skipped, so an unbounded (non-expiring)
    // proof is accepted. The sibling EIP-3009 path (verifyEip3009Auth) requires
    // validBefore, so the two auth paths must agree: reject when it is missing.
    const header = Buffer.from(
      JSON.stringify({
        x402Version: 1,
        scheme: "exact",
        network: "base",
        payload: {
          signature: "0xabcd",
          authorization: {
            from: TEST_CALLER,
            to: operator,
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

  it("X-Payment: takes precedence over Authorization header", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: {
        "X-Payment": makeXPaymentHeader(),
        Authorization: "EIP-3009 stale-token",
      },
    })

    const response = await gate.check(request, ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(TEST_CALLER)
  })

  it("X-Payment: returns 400 for unsupported x402Version", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const operator =
      "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as `0x${string}`
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      operatorAddress: operator,
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
            to: operator,
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

  it("EIP-3009: returns 401 when authorization is expired", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeEip3009Request({
        validBefore: String(Math.floor(Date.now() / 1000) - 60),
      }),
      ctx,
    )

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/expired/i)
  })

  it("EIP-3009: returns 401 when authorization is not yet valid", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeEip3009Request({
        validAfter: String(Math.floor(Date.now() / 1000) + 3600),
      }),
      ctx,
    )

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/not yet valid/i)
  })

  it("EIP-3009: returns 401 when signature recovery fails", async () => {
    mockRecoverTypedDataAddress.mockRejectedValueOnce(
      new Error("bad signature"),
    )
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeEip3009Request(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/invalid EIP-3009 signature/i)
  })

  it("EIP-3009: returns 401 when recovered address does not match 'from'", async () => {
    mockRecoverTypedDataAddress.mockResolvedValueOnce(
      "0x9999999999999999999999999999999999999999" as `0x${string}`,
    )
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(makeEip3009Request(), ctx)

    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toMatch(/signer does not match/i)
  })
})
