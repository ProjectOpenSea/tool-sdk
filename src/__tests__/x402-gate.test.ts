import { describe, expect, it } from "vitest"
import { x402Gate } from "../lib/middleware/x402.js"

const mockPricing = [
  {
    amount: "20000",
    asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    recipient: "eip155:8453:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
    protocol: "x402",
  },
]

describe("x402Gate", () => {
  it("should return 402 when no X-Payment header is present", async () => {
    const gate = x402Gate({ pricing: mockPricing })
    const request = new Request("https://example.com/api", {
      method: "POST",
    })
    const response = await gate.check(request, { gates: {} })
    expect(response).not.toBeNull()
    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.error).toBe("Payment required")
    expect(body.requirements).toEqual(mockPricing)
    expect(response?.headers.get("X-Accept-Payment")).toBe("x402")
  })

  it("should return 501 when X-Payment present but no verifyPayment callback", async () => {
    const gate = x402Gate({ pricing: mockPricing })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": "some-proof" },
    })
    const response = await gate.check(request, { gates: {} })
    expect(response).not.toBeNull()
    expect(response?.status).toBe(501)
    const body = await response?.json()
    expect(body.error).toBe("Payment verification not configured")
  })

  it("should return 402 when verifyPayment returns false", async () => {
    const gate = x402Gate({
      pricing: mockPricing,
      verifyPayment: async () => false,
    })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": "invalid-proof" },
    })
    const response = await gate.check(request, { gates: {} })
    expect(response).not.toBeNull()
    expect(response?.status).toBe(402)
    const body = await response?.json()
    expect(body.error).toBe("Invalid payment proof")
  })

  it("should return null and mark paid when verifyPayment returns true", async () => {
    const gate = x402Gate({
      pricing: mockPricing,
      verifyPayment: async () => true,
    })
    const request = new Request("https://example.com/api", {
      method: "POST",
      headers: { "X-Payment": "valid-proof" },
    })
    const ctx = { gates: {} as Record<string, unknown> }
    const response = await gate.check(request, ctx)
    expect(response).toBeNull()
    expect(ctx.gates.x402).toEqual({ paid: true })
  })
})
