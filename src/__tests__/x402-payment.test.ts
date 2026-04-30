import type { WalletAdapter } from "@opensea/wallet-adapters"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  type PaymentRequirements,
  paidFetch,
  signX402Payment,
} from "../lib/client/x402-payment.js"

const signer = privateKeyToAccount(generatePrivateKey())

const baseRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "10000",
  payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("signX402Payment", () => {
  it("returns valid base64 that decodes to a correct payment payload", async () => {
    const result = await signX402Payment({
      signer,
      paymentRequirements: baseRequirements,
    })

    const raw = atob(result)
    const parsed = JSON.parse(raw)

    expect(parsed.x402Version).toBe(1)
    expect(parsed.scheme).toBe("exact")
    expect(parsed.network).toBe("base")
    expect(parsed.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
    expect(parsed.payload.authorization.from).toBe(signer.address)
    expect(parsed.payload.authorization.to).toBe(baseRequirements.payTo)
    expect(parsed.payload.authorization.value).toBe("10000")
    expect(parsed.payload.authorization.validAfter).toBe("0")
    expect(parsed.payload.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(Number(parsed.payload.authorization.validBefore)).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    )
  })

  it("uses extra.name and extra.version in the EIP-712 domain", async () => {
    const defaultResult = await signX402Payment({
      signer,
      paymentRequirements: baseRequirements,
    })
    const customResult = await signX402Payment({
      signer,
      paymentRequirements: {
        ...baseRequirements,
        extra: { name: "Bridged USDC", version: "1" },
      },
    })
    const defaultSig = JSON.parse(atob(defaultResult)).payload.signature
    const customSig = JSON.parse(atob(customResult)).payload.signature
    expect(defaultSig).toMatch(/^0x[0-9a-f]+$/i)
    expect(customSig).toMatch(/^0x[0-9a-f]+$/i)
    expect(defaultSig).not.toBe(customSig)
  })

  it("supports base-sepolia network", async () => {
    const reqs: PaymentRequirements = {
      ...baseRequirements,
      network: "base-sepolia",
    }
    const result = await signX402Payment({ signer, paymentRequirements: reqs })
    const parsed = JSON.parse(atob(result))
    expect(parsed.network).toBe("base-sepolia")
  })

  it("throws for unsupported network", async () => {
    const reqs = {
      ...baseRequirements,
      network: "ethereum" as "base",
    }
    await expect(
      signX402Payment({ signer, paymentRequirements: reqs }),
    ).rejects.toThrow("Unsupported network: ethereum")
  })

  it("echoes the scheme from requirements into the payload", async () => {
    const reqs: PaymentRequirements = {
      ...baseRequirements,
      scheme: "custom-scheme",
    }
    const result = await signX402Payment({ signer, paymentRequirements: reqs })
    const parsed = JSON.parse(atob(result))
    expect(parsed.scheme).toBe("custom-scheme")
  })

  it("works with a WalletAdapter signer", async () => {
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

    const result = await signX402Payment({
      signer: mockAdapter,
      paymentRequirements: baseRequirements,
    })
    const parsed = JSON.parse(atob(result))

    expect(parsed.x402Version).toBe(1)
    expect(parsed.scheme).toBe("exact")
    expect(parsed.payload.authorization.from).toBe(
      "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
    )
    expect(parsed.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })

  it("throws when WalletAdapter lacks signTypedData", async () => {
    const mockAdapter: WalletAdapter = {
      name: "no-typed-data",
      capabilities: {
        signMessage: false,
        signTypedData: false,
        managedGas: false,
        managedNonce: false,
      },
      getAddress: async () => "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
      sendTransaction: async () => ({ hash: "0x" }),
    }

    await expect(
      signX402Payment({
        signer: mockAdapter,
        paymentRequirements: baseRequirements,
      }),
    ).rejects.toThrow("does not support signTypedData")
  })
})

describe("paidFetch", () => {
  it("returns the 402 replay response with X-Payment header on success", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      callCount++
      if (callCount === 1) {
        return new Response(JSON.stringify({ accepts }), { status: 402 })
      }
      expect(new Headers(init?.headers).get("X-Payment")).toBeTruthy()
      return new Response(JSON.stringify({ result: "ok" }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const res = await paidFetch("https://tool.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
      signer,
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const body = await res.json()
    expect(body.result).toBe("ok")
  })

  it("returns non-402 responses as-is without signing", async () => {
    const fetchMock = vi.fn(
      async () => new Response(JSON.stringify({ ok: true }), { status: 200 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await paidFetch("https://tool.example.com/api", {
      method: "POST",
      signer,
    })

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("throws when 402 body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("not json", { status: 402 })),
    )

    await expect(
      paidFetch("https://tool.example.com/api", { method: "POST", signer }),
    ).rejects.toThrow("x402: server returned 402 but body is not valid JSON")
  })

  it("throws when 402 body.accepts is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({}), { status: 402 })),
    )

    await expect(
      paidFetch("https://tool.example.com/api", { method: "POST", signer }),
    ).rejects.toThrow(
      "x402: server returned 402 but body.accepts is missing or empty",
    )
  })

  it("throws when body is a ReadableStream", async () => {
    const stream = new ReadableStream()
    await expect(
      paidFetch("https://tool.example.com/api", {
        method: "POST",
        body: stream,
        signer,
      }),
    ).rejects.toThrow("paidFetch does not support ReadableStream bodies")
  })

  it("throws when 402 body.accepts is empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ accepts: [] }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", { method: "POST", signer }),
    ).rejects.toThrow(
      "x402: server returned 402 but body.accepts is missing or empty",
    )
  })

  it("rejects payTo zero address", async () => {
    const accepts = [
      {
        ...baseRequirements,
        payTo: "0x0000000000000000000000000000000000000000",
      },
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", { method: "POST", signer }),
    ).rejects.toThrow("burn/zero address")
  })

  it("rejects payTo burn address", async () => {
    const accepts = [
      {
        ...baseRequirements,
        payTo: "0x000000000000000000000000000000000000dEaD",
      },
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", { method: "POST", signer }),
    ).rejects.toThrow("burn/zero address")
  })

  it("rejects payTo not in allowedRecipients", async () => {
    const accepts = [baseRequirements]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", {
        method: "POST",
        signer,
        allowedRecipients: ["0x1111111111111111111111111111111111111111"],
      }),
    ).rejects.toThrow("not in allowedRecipients")
  })

  it("allows payTo in allowedRecipients (case-insensitive)", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify({ accepts }), { status: 402 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const res = await paidFetch("https://tool.example.com/api", {
      method: "POST",
      signer,
      allowedRecipients: [baseRequirements.payTo.toUpperCase()],
    })
    expect(res.status).toBe(200)
  })

  it("rejects when maxAmountRequired exceeds maxAmount", async () => {
    const accepts = [{ ...baseRequirements, maxAmountRequired: "50000" }]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", {
        method: "POST",
        signer,
        maxAmount: "10000",
      }),
    ).rejects.toThrow("server requested 50000 but maxAmount is 10000")
  })

  it("allows amount within maxAmount", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify({ accepts }), { status: 402 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const res = await paidFetch("https://tool.example.com/api", {
      method: "POST",
      signer,
      maxAmount: "10000",
    })
    expect(res.status).toBe(200)
  })

  it("rejects non-USDC asset by default", async () => {
    const accepts = [
      {
        ...baseRequirements,
        asset: "0x1111111111111111111111111111111111111111",
      },
    ]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", { method: "POST", signer }),
    ).rejects.toThrow("does not match expected USDC address")
  })

  it("accepts known USDC asset by default", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify({ accepts }), { status: 402 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const res = await paidFetch("https://tool.example.com/api", {
      method: "POST",
      signer,
    })
    expect(res.status).toBe(200)
  })

  it("rejects asset not in custom allowedAssets", async () => {
    const accepts = [baseRequirements]
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ accepts }), { status: 402 }),
      ),
    )

    await expect(
      paidFetch("https://tool.example.com/api", {
        method: "POST",
        signer,
        allowedAssets: ["0x2222222222222222222222222222222222222222"],
      }),
    ).rejects.toThrow("not in allowedAssets")
  })

  it("accepts asset in custom allowedAssets (case-insensitive)", async () => {
    const accepts = [baseRequirements]
    let callCount = 0
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        callCount++
        if (callCount === 1) {
          return new Response(JSON.stringify({ accepts }), { status: 402 })
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const res = await paidFetch("https://tool.example.com/api", {
      method: "POST",
      signer,
      allowedAssets: [baseRequirements.asset.toUpperCase()],
    })
    expect(res.status).toBe(200)
  })
})
