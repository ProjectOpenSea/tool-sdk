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

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    tryHasAccess = mockTryHasAccess
    getToolConfig = mockGetToolConfig
  },
}))

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: () => ({
      verifySiweMessage: vi.fn().mockResolvedValue(true),
    }),
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
    expect(body.error).toContain("SIWE authorization required")
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
})
