import { describe, expect, it, vi } from "vitest"
import { nftGate } from "../lib/middleware/nft-gate.js"
import type { ToolContext } from "../types.js"

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: vi.fn().mockResolvedValue(1n),
      verifySiweMessage: vi.fn().mockResolvedValue(true),
    }),
  }
})

vi.mock("viem/siwe", () => ({
  parseSiweMessage: vi.fn().mockReturnValue({
    address: "0xabcdefabcdef1234567890abcdefabcdef123456",
    domain: "example.com",
    uri: "https://example.com",
    version: "1",
    chainId: 8453,
    nonce: "testnonce",
    issuedAt: new Date(),
  }),
}))

const testCollection = "0x1234567890abcdef1234567890abcdef12345678" as const

describe("nftGate", () => {
  it("should return 401 when no Authorization header", async () => {
    const gate = nftGate({ collection: testCollection })
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

  it("should return 401 when Authorization header has wrong format", async () => {
    const gate = nftGate({ collection: testCollection })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: "Bearer some-token" },
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const response = await gate.check(request, ctx)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })

  it("should return 401 when SIWE token has no dot separator", async () => {
    const gate = nftGate({ collection: testCollection })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: "SIWE nodot" },
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const response = await gate.check(request, ctx)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
  })

  it("should return 401 when SIWE domain does not match request", async () => {
    const { parseSiweMessage } = await import("viem/siwe")
    vi.mocked(parseSiweMessage).mockReturnValueOnce({
      address: "0xabcdefabcdef1234567890abcdefabcdef123456",
      domain: "other-service.com",
      uri: "https://other-service.com",
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
    const gate = nftGate({ collection: testCollection })
    const message = Buffer.from(
      "other-service.com wants you to sign in",
    ).toString("base64url")
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `SIWE ${message}.0xdeadbeef` },
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const response = await gate.check(request, ctx)
    expect(response).not.toBeNull()
    expect(response?.status).toBe(401)
    const body = await response?.json()
    expect(body.error).toContain("domain mismatch")
  })

  it("should pass when expirationTime is absent", async () => {
    const { parseSiweMessage } = await import("viem/siwe")
    vi.mocked(parseSiweMessage).mockReturnValueOnce({
      address: "0xabcdefabcdef1234567890abcdefabcdef123456",
      domain: "example.com",
      uri: "https://example.com",
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
    const gate = nftGate({ collection: testCollection })
    const message = Buffer.from("example.com wants you to sign in").toString(
      "base64url",
    )
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `SIWE ${message}.0xdeadbeef` },
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const response = await gate.check(request, ctx)
    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe("0xabcdefabcdef1234567890abcdefabcdef123456")
  })

  it("should return null and set callerAddress on success", async () => {
    const gate = nftGate({ collection: testCollection })
    const message = Buffer.from("example.com wants you to sign in").toString(
      "base64url",
    )
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { Authorization: `SIWE ${message}.0xdeadbeef` },
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const response = await gate.check(request, ctx)
    expect(response).toBeNull()
    expect(ctx.callerAddress).toBe("0xabcdefabcdef1234567890abcdefabcdef123456")
  })

  it("should return 401 when the SIWE signature does not start with 0x", async () => {
    const gate = nftGate({ collection: testCollection })
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
  })
})
