import type { WalletAdapter } from "@opensea/wallet-adapters"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { PaymentRequirements } from "../lib/client/x402-payment.js"

const mockReadContract = vi.fn().mockResolvedValue(1n)
const mockVerifySiweMessage = vi.fn().mockResolvedValue(true)

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    createPublicClient: () => ({
      readContract: mockReadContract,
      verifySiweMessage: mockVerifySiweMessage,
    }),
  }
})

const account = privateKeyToAccount(generatePrivateKey())

const baseRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "10000",
  payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
}

afterEach(() => {
  vi.unstubAllGlobals()
  mockReadContract.mockClear()
  mockVerifySiweMessage.mockClear()
})

describe("paidAuthenticatedFetch", () => {
  it("sends SIWE auth header on initial request", async () => {
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
      account,
      method: "POST",
      body: JSON.stringify({ query: "test" }),
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = new Headers(capturedInit?.headers)
    const authHeader = headers.get("Authorization")
    expect(authHeader).toBeTruthy()
    expect(authHeader).toMatch(/^SIWE .+\..+$/)
  })

  it("returns non-402 responses directly without payment attempt", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    const res = await paidAuthenticatedFetch(
      "https://my-tool.vercel.app/api/invoke",
      { account },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBe("ok")
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("handles 402 by signing payment and retrying with both headers", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    const capturedInits: RequestInit[] = []

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInits.push(init ?? {})
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({ accepts }), { status: 402 })
      }
      return new Response(JSON.stringify({ result: "paid" }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    const res = await paidAuthenticatedFetch(
      "https://my-tool.vercel.app/api/invoke",
      {
        account,
        method: "POST",
        body: JSON.stringify({ query: "test" }),
      },
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(res.status).toBe(200)

    const firstHeaders = new Headers(capturedInits[0].headers)
    expect(firstHeaders.get("Authorization")).toMatch(/^SIWE /)
    expect(firstHeaders.get("X-Payment")).toBeNull()

    const secondHeaders = new Headers(capturedInits[1].headers)
    expect(secondHeaders.get("Authorization")).toMatch(/^SIWE /)
    expect(secondHeaders.get("X-Payment")).toBeTruthy()
  })

  it("uses signer option for payment signing when provided", async () => {
    const accepts = [baseRequirements]
    let callCount = 0

    const mockAdapter: WalletAdapter = {
      name: "mock",
      capabilities: {
        signMessage: true,
        signTypedData: true,
        managedGas: false,
        managedNonce: false,
      },
      getAddress: async () => "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
      sendTransaction: async () => ({ hash: "0x" }),
      signTypedData: async () => `0x${"ab".repeat(32)}${"cd".repeat(32)}1b`,
    }

    const fetchMock = vi.fn(async () => {
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({ accepts }), { status: 402 })
      }
      return new Response(JSON.stringify({ result: "paid" }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    const res = await paidAuthenticatedFetch(
      "https://my-tool.vercel.app/api/invoke",
      {
        account,
        signer: mockAdapter,
        method: "POST",
        body: JSON.stringify({ query: "test" }),
      },
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it("throws when maxAmount is exceeded", async () => {
    const accepts = [{ ...baseRequirements, maxAmountRequired: "50000" }]
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
        maxAmount: "10000",
      }),
    ).rejects.toThrow("server requested 50000 but maxAmount is 10000")
  })

  it("throws when payTo is not in allowedRecipients", async () => {
    const accepts = [baseRequirements]
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
        allowedRecipients: ["0x1111111111111111111111111111111111111111"],
      }),
    ).rejects.toThrow("not in allowedRecipients")
  })

  it("throws when asset is not in allowedAssets", async () => {
    const accepts = [baseRequirements]
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
        allowedAssets: ["0x1111111111111111111111111111111111111111"],
      }),
    ).rejects.toThrow("not in allowedAssets")
  })

  it("throws when payTo is a rejected address", async () => {
    const accepts = [
      {
        ...baseRequirements,
        payTo: "0x0000000000000000000000000000000000000000",
      },
    ]
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
      }),
    ).rejects.toThrow("burn/zero address")
  })

  it("throws when 402 body is not valid JSON", async () => {
    const fetchMock = vi.fn(
      async () => new Response("not json", { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
      }),
    ).rejects.toThrow("body is not valid JSON")
  })

  it("throws when 402 body.accepts is empty", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ accepts: [] }), { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
      }),
    ).rejects.toThrow("body.accepts is missing or empty")
  })

  it("throws when account lacks signMessage", async () => {
    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    const noSignAccount = { address: account.address } as any

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account: noSignAccount,
      }),
    ).rejects.toThrow("account.signMessage is required")
  })

  it("throws when body is a ReadableStream", async () => {
    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    const stream = new ReadableStream()

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
        body: stream,
      }),
    ).rejects.toThrow("does not support ReadableStream")
  })

  it("rejects non-USDC asset by default when allowedAssets is not provided", async () => {
    const accepts = [
      {
        ...baseRequirements,
        asset: "0x1111111111111111111111111111111111111111",
      },
    ]
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await expect(
      paidAuthenticatedFetch("https://my-tool.vercel.app/api/invoke", {
        account,
      }),
    ).rejects.toThrow("does not match expected USDC address")
  })

  it("preserves existing headers alongside Authorization and X-Payment", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    let secondCallInit: RequestInit | undefined

    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({ accepts }), { status: 402 })
      }
      secondCallInit = init
      return new Response("ok", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { paidAuthenticatedFetch } = await import(
      "../lib/client/paid-authenticated-fetch.js"
    )

    await paidAuthenticatedFetch("https://example.com/api", {
      account,
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
    })

    const headers = new Headers(secondCallInit?.headers)
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("X-Custom")).toBe("value")
    expect(headers.get("Authorization")).toMatch(/^SIWE /)
    expect(headers.get("X-Payment")).toBeTruthy()
  })
})
