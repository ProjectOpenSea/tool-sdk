import type { WalletAdapter } from "@opensea/wallet-adapters"
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { describe, expect, it } from "vitest"
import {
  createX402Client,
  type PaymentRequirements,
} from "../lib/client/x402-payment.js"
import {
  ExactEip3009Scheme,
  signEip3009Authorization,
  toX402PaymentRequired,
  UptoEip3009Scheme,
} from "../lib/client/x402-scheme.js"

const signer = privateKeyToAccount(generatePrivateKey())

const baseRequirements: PaymentRequirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "10000",
  payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
}

describe("ExactEip3009Scheme", () => {
  it("creates a v1 payload with scheme and network fields", async () => {
    const scheme = new ExactEip3009Scheme(signer)
    const result = await scheme.createPaymentPayload(1, {
      scheme: "exact",
      network: "eip155:8453",
      asset: baseRequirements.asset,
      amount: "10000",
      payTo: baseRequirements.payTo,
      maxTimeoutSeconds: 600,
      extra: {},
    })

    const payload = result.payload as {
      signature: string
      authorization: Record<string, string>
    }
    expect(result.x402Version).toBe(1)
    expect((result as Record<string, unknown>).scheme).toBe("exact")
    // v1 payloads normalize the network to the canonical short name so v1
    // gates (which key off short names) accept it, even when the challenge
    // advertised the CAIP-2 form.
    expect((result as Record<string, unknown>).network).toBe("base")
    expect(payload.signature).toMatch(/^0x[0-9a-f]+$/i)
    expect(payload.authorization.from).toBe(signer.address)
    expect(payload.authorization.to).toBe(baseRequirements.payTo)
    expect(payload.authorization.value).toBe("10000")
  })

  it("creates a v2 payload without scheme/network fields", async () => {
    const scheme = new ExactEip3009Scheme(signer)
    const result = await scheme.createPaymentPayload(2, {
      scheme: "exact",
      network: "eip155:8453",
      asset: baseRequirements.asset,
      amount: "10000",
      payTo: baseRequirements.payTo,
      maxTimeoutSeconds: 600,
      extra: {},
    })

    expect(result.x402Version).toBe(2)
    expect((result as Record<string, unknown>).scheme).toBeUndefined()
    expect((result as Record<string, unknown>).network).toBeUndefined()
    expect(result.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
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

    const scheme = new ExactEip3009Scheme(mockAdapter)
    const result = await scheme.createPaymentPayload(1, {
      scheme: "exact",
      network: "eip155:8453",
      asset: baseRequirements.asset,
      amount: "10000",
      payTo: baseRequirements.payTo,
      maxTimeoutSeconds: 600,
      extra: {},
    })

    const payload = result.payload as {
      signature: string
      authorization: Record<string, string>
    }
    expect(payload.authorization.from).toBe(
      "0xAbCdEf1234567890abcdef1234567890AbCdEf12",
    )
    expect(payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })
})

describe("signEip3009Authorization", () => {
  it("produces a valid signature and authorization fields", async () => {
    const result = await signEip3009Authorization(signer, {
      network: "base",
      payTo: baseRequirements.payTo,
      asset: baseRequirements.asset,
      amount: "10000",
    })

    expect(result.signature).toMatch(/^0x[0-9a-f]+$/i)
    expect(result.authorization.from).toBe(signer.address)
    expect(result.authorization.to).toBe(baseRequirements.payTo)
    expect(result.authorization.value).toBe("10000")
    expect(result.authorization.validAfter).toBe("0")
    expect(result.authorization.nonce).toMatch(/^0x[0-9a-f]{64}$/i)
    expect(Number(result.authorization.validBefore)).toBeGreaterThan(
      Math.floor(Date.now() / 1000),
    )
  })

  it("uses maxAmountRequired as fallback when amount is absent", async () => {
    const result = await signEip3009Authorization(signer, {
      network: "base",
      payTo: baseRequirements.payTo,
      asset: baseRequirements.asset,
      maxAmountRequired: "5000",
    })

    expect(result.authorization.value).toBe("5000")
  })

  it("throws for unsupported network", async () => {
    await expect(
      signEip3009Authorization(signer, {
        network: "ethereum",
        payTo: baseRequirements.payTo,
        asset: baseRequirements.asset,
        amount: "10000",
      }),
    ).rejects.toThrow("Unsupported network: ethereum")
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
      getAddress: async () => "0x1111111111111111111111111111111111111111",
      sendTransaction: async () => ({ hash: "0x" }),
    }

    await expect(
      signEip3009Authorization(mockAdapter, {
        network: "base",
        payTo: baseRequirements.payTo,
        asset: baseRequirements.asset,
        amount: "10000",
      }),
    ).rejects.toThrow("does not support signTypedData")
  })

  it("uses extra.name and extra.version in the EIP-712 domain", async () => {
    const defaultResult = await signEip3009Authorization(signer, {
      network: "base",
      payTo: baseRequirements.payTo,
      asset: baseRequirements.asset,
      amount: "10000",
    })
    const customResult = await signEip3009Authorization(signer, {
      network: "base",
      payTo: baseRequirements.payTo,
      asset: baseRequirements.asset,
      amount: "10000",
      extra: { name: "Bridged USDC", version: "1" },
    })

    expect(defaultResult.signature).not.toBe(customResult.signature)
  })
})

describe("UptoEip3009Scheme", () => {
  it("creates a v1 payload with upto scheme identifier", async () => {
    const scheme = new UptoEip3009Scheme(signer)
    const result = await scheme.createPaymentPayload(1, {
      scheme: "upto",
      network: "eip155:8453",
      asset: baseRequirements.asset,
      amount: "10000",
      payTo: baseRequirements.payTo,
      maxTimeoutSeconds: 600,
      extra: {},
    })

    const payload = result.payload as {
      signature: string
      authorization: Record<string, string>
    }
    expect(result.x402Version).toBe(1)
    expect((result as Record<string, unknown>).scheme).toBe("upto")
    // v1 payloads normalize CAIP-2 networks to the canonical short name.
    expect((result as Record<string, unknown>).network).toBe("base")
    expect(payload.signature).toMatch(/^0x[0-9a-f]+$/i)
    expect(payload.authorization.from).toBe(signer.address)
    expect(payload.authorization.to).toBe(baseRequirements.payTo)
    expect(payload.authorization.value).toBe("10000")
  })

  it("creates a v2 payload without scheme/network fields", async () => {
    const scheme = new UptoEip3009Scheme(signer)
    const result = await scheme.createPaymentPayload(2, {
      scheme: "upto",
      network: "eip155:8453",
      asset: baseRequirements.asset,
      amount: "10000",
      payTo: baseRequirements.payTo,
      maxTimeoutSeconds: 600,
      extra: {},
    })

    expect(result.x402Version).toBe(2)
    expect((result as Record<string, unknown>).scheme).toBeUndefined()
    expect((result as Record<string, unknown>).network).toBeUndefined()
    expect(result.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })

  it("has scheme property set to upto", () => {
    const scheme = new UptoEip3009Scheme(signer)
    expect(scheme.scheme).toBe("upto")
  })
})

describe("createX402Client", () => {
  const v2Requirements: PaymentRequirements = {
    ...baseRequirements,
    network: "eip155:8453",
  }

  it("routes to exact scheme for exact requirements", async () => {
    const client = createX402Client(signer, "eip155:8453", 2)
    const paymentRequired = toX402PaymentRequired({
      requirements: { ...v2Requirements, scheme: "exact" },
      x402Version: 2,
      raw: { scheme: "exact", network: "eip155:8453", amount: "10000" },
    })
    const result = await client.createPaymentPayload(paymentRequired)
    expect(result.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })

  it("routes to upto scheme for upto requirements", async () => {
    const client = createX402Client(signer, "eip155:8453", 2)
    const paymentRequired = toX402PaymentRequired({
      requirements: { ...v2Requirements, scheme: "upto" },
      x402Version: 2,
      raw: { scheme: "upto", network: "eip155:8453", amount: "10000" },
    })
    const result = await client.createPaymentPayload(paymentRequired)
    expect(result.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })

  it("registers both schemes for v1", async () => {
    const client = createX402Client(signer, "base", 1)
    const paymentRequired = toX402PaymentRequired({
      requirements: { ...baseRequirements, scheme: "upto" },
      x402Version: 1,
      raw: { scheme: "upto", network: "base", amount: "10000" },
    })
    const result = await client.createPaymentPayload(paymentRequired)
    expect(result.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })
})

describe("toX402PaymentRequired", () => {
  it("builds a PaymentRequired with correct fields", () => {
    const result = toX402PaymentRequired({
      requirements: baseRequirements,
      x402Version: 2,
      raw: { maxTimeoutSeconds: 300 },
    })

    expect(result.x402Version).toBe(2)
    expect(result.accepts).toHaveLength(1)
    expect(result.accepts[0].scheme).toBe("exact")
    expect(result.accepts[0].amount).toBe("10000")
    expect(result.accepts[0].payTo).toBe(baseRequirements.payTo)
    expect(result.accepts[0].asset).toBe(baseRequirements.asset)
    expect(result.accepts[0].maxTimeoutSeconds).toBe(300)
  })

  it("preserves resource when provided", () => {
    const resource = {
      url: "https://api.example.com/data",
      mimeType: "application/json",
    }
    const result = toX402PaymentRequired({
      requirements: baseRequirements,
      x402Version: 2,
      raw: {},
      resource,
    })

    expect(result.resource).toEqual(resource)
  })

  it("falls back to empty resource when not provided", () => {
    const result = toX402PaymentRequired({
      requirements: baseRequirements,
      x402Version: 1,
      raw: {},
    })

    expect(result.resource).toEqual({ url: "", mimeType: "" })
  })

  it("defaults maxTimeoutSeconds to 600 when not in raw", () => {
    const result = toX402PaymentRequired({
      requirements: baseRequirements,
      x402Version: 2,
      raw: {},
    })

    expect(result.accepts[0].maxTimeoutSeconds).toBe(600)
  })

  it("passes through extra from requirements", () => {
    const reqs = {
      ...baseRequirements,
      extra: { name: "Bridged USDC", version: "1" },
    }
    const result = toX402PaymentRequired({
      requirements: reqs,
      x402Version: 2,
      raw: {},
    })

    expect(result.accepts[0].extra).toEqual({
      name: "Bridged USDC",
      version: "1",
    })
  })
})
