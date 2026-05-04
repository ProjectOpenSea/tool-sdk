import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { ToolContext } from "../types.js"

const TEST_TOOL_ID = 42n
const AGENT_ADDRESS =
  "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48" as `0x${string}`
const HOLDER_ADDRESS =
  "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984" as `0x${string}`
const TEST_PREDICATE =
  "0xpredicatepredicatepredicatepredicatepredi" as `0x${string}`

const mockTryHasAccess = vi.fn(async () => ({ ok: true, granted: true }))
const mockGetToolConfig = vi.fn(async () => ({
  creator: "0xcreatorcreatorcreatorcreatorcreatorcreator",
  metadataURI: "https://example.com/manifest.json",
  manifestHash: "0x0",
  accessPredicate: TEST_PREDICATE,
}))

const mockReadContract = vi.fn()

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
      readContract: mockReadContract,
    }),
  }
})

vi.mock("viem/siwe", () => ({
  parseSiweMessage: vi.fn().mockReturnValue({
    address: AGENT_ADDRESS,
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
  mockReadContract.mockReset()
  mockReadContract.mockResolvedValue(true)
})

afterEach(() => {
  vi.clearAllMocks()
})

function makeAuthHeader(): string {
  const siweB64 = btoa("mock-siwe-message")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "")
  return `SIWE ${siweB64}.0xmocksignature`
}

function makeRequest(headers?: Record<string, string>): Request {
  return new Request("https://example.com/api", {
    method: "POST",
    headers: {
      Authorization: makeAuthHeader(),
      ...headers,
    },
  })
}

describe("predicateGate with delegate.xyz delegation", () => {
  it("passes and sets callerAddress to holder + agentAddress to agent", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeRequest({ "X-Delegate-For": HOLDER_ADDRESS }),
      ctx,
    )

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(HOLDER_ADDRESS)
    expect(ctx.agentAddress).toBe(AGENT_ADDRESS)
    expect(ctx.gates?.predicate).toEqual({ granted: true })
    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      HOLDER_ADDRESS,
      "0x",
    )
    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        functionName: "checkDelegateForAll",
        args: [
          AGENT_ADDRESS,
          HOLDER_ADDRESS,
          "0x0000000000000000000000000000000000000000000000000000000000000000",
        ],
      }),
    )
  })

  it("returns 403 when delegate.xyz delegation not found", async () => {
    mockReadContract.mockResolvedValue(false)

    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeRequest({ "X-Delegate-For": HOLDER_ADDRESS }),
      ctx,
    )

    expect(response?.status).toBe(403)
    const body = await response?.json()
    expect(body.error).toMatch(/delegation not found/i)
    expect(mockTryHasAccess).not.toHaveBeenCalled()
  })

  it("returns 400 for invalid X-Delegate-For address", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeRequest({ "X-Delegate-For": "not-an-address" }),
      ctx,
    )

    expect(response?.status).toBe(400)
    const body = await response?.json()
    expect(body.error).toMatch(/invalid X-Delegate-For/i)
  })

  it("returns 502 when delegate registry call fails", async () => {
    mockReadContract.mockRejectedValue(new Error("RPC timeout"))

    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeRequest({ "X-Delegate-For": HOLDER_ADDRESS }),
      ctx,
    )

    expect(response?.status).toBe(502)
    const body = await response?.json()
    expect(body.error).toMatch(/delegate registry call failed/i)
  })

  it("returns 403 when holder does not pass predicate", async () => {
    mockTryHasAccess.mockResolvedValue({ ok: true, granted: false })

    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })
    const ctx: Partial<ToolContext> = { gates: {} }

    const response = await gate.check(
      makeRequest({ "X-Delegate-For": HOLDER_ADDRESS }),
      ctx,
    )

    expect(response?.status).toBe(403)
    const body = await response?.json()
    expect(body.error).toMatch(/access predicate denied/i)
    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      HOLDER_ADDRESS,
      "0x",
    )
  })

  it("does not set agentAddress when X-Delegate-For is absent", async () => {
    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({ toolId: TEST_TOOL_ID })

    // Override parseSiweMessage to return AGENT_ADDRESS as caller for this test
    mockTryHasAccess.mockResolvedValue({ ok: true, granted: true })

    const ctx: Partial<ToolContext> = { gates: {} }
    const response = await gate.check(makeRequest(), ctx)

    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe(AGENT_ADDRESS)
    expect(ctx.agentAddress).toBeUndefined()
    expect(mockReadContract).not.toHaveBeenCalled()
  })

  it("uses custom delegateRegistryAddress when provided", async () => {
    const customAddress = "0xaB5801a7D398351b8bE11C439e05C5B3259aeC9B" as const

    const { predicateGate } = await import(
      "../lib/middleware/predicate-gate.js"
    )
    const gate = predicateGate({
      toolId: TEST_TOOL_ID,
      delegateRegistryAddress: customAddress,
    })
    const ctx: Partial<ToolContext> = { gates: {} }

    await gate.check(makeRequest({ "X-Delegate-For": HOLDER_ADDRESS }), ctx)

    expect(mockReadContract).toHaveBeenCalledWith(
      expect.objectContaining({
        address: customAddress,
      }),
    )
  })
})
