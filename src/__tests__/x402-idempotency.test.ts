import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  idempotencyNonce,
  type PaymentRequirements,
  paidFetch,
} from "../lib/client/x402-payment.js"
import { signEip3009Authorization } from "../lib/client/x402-scheme.js"

const signer = privateKeyToAccount(generatePrivateKey())

const requirements: PaymentRequirements = {
  scheme: "exact",
  network: "base",
  maxAmountRequired: "10000",
  payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
}

afterEach(() => {
  vi.unstubAllGlobals()
})

/** Serves one 402 challenge, then 200, and returns the signed nonce. */
async function paidNonce(
  options: { idempotencyKey?: string; allowedAssets?: string[] },
  amount = requirements.maxAmountRequired,
): Promise<string> {
  let payment: string | null = null
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      payment = new Headers(init?.headers).get("X-Payment")
      if (payment === null) {
        return new Response(
          JSON.stringify({
            accepts: [{ ...requirements, maxAmountRequired: amount }],
          }),
          { status: 402 },
        )
      }
      return new Response("{}", { status: 200 })
    }),
  )
  await paidFetch("https://tool.example.com/api", {
    method: "POST",
    body: "{}",
    signer,
    ...options,
  })
  if (payment === null) throw new Error("no payment was sent")
  return JSON.parse(atob(payment)).payload.authorization.nonce
}

const pinned = { allowedAssets: [requirements.asset] }

describe("idempotencyNonce", () => {
  it("derives keccak256 of the namespaced key", () => {
    // keccak256(utf8("opensea-tool-sdk/x402/idempotency:order-1")), computed
    // with ethers. Changing the derivation would break retries across versions.
    expect(idempotencyNonce("order-1")).toBe(
      "0xb35519af24dd4f0a84b2795af5c830eedb0be35f1895a3f0995b1c4862be79f0",
    )
  })

  it("is a stable 32-byte nonce per key", () => {
    const nonce = idempotencyNonce("order-1")
    expect(nonce).toMatch(/^0x[0-9a-f]{64}$/)
    expect(idempotencyNonce("order-1")).toBe(nonce)
    expect(idempotencyNonce("order-2")).not.toBe(nonce)
  })

  it("rejects an empty key", () => {
    expect(() => idempotencyNonce("")).toThrow(
      "idempotencyKey must be a non-empty string",
    )
  })
})

describe("signEip3009Authorization nonce option", () => {
  const reqs = {
    network: "base",
    payTo: requirements.payTo,
    asset: requirements.asset,
    amount: "10000",
  }

  it("signs the given nonce", async () => {
    const nonce = idempotencyNonce("order-1")
    const { authorization } = await signEip3009Authorization(signer, reqs, {
      nonce,
    })
    expect(authorization.nonce).toBe(nonce)
  })

  it("rejects a nonce that is not 32 bytes of hex", async () => {
    await expect(
      signEip3009Authorization(signer, reqs, { nonce: "0x1234" }),
    ).rejects.toThrow("EIP-3009 nonce must be 32 bytes of 0x-prefixed hex")
  })
})

describe("paidFetch idempotencyKey", () => {
  it("signs the same nonce on every retry with the same key", async () => {
    const first = await paidNonce({ idempotencyKey: "order-1", ...pinned })
    const retry = await paidNonce({ idempotencyKey: "order-1", ...pinned })

    expect(first).toBe(idempotencyNonce("order-1"))
    expect(retry).toBe(first)
    expect(await paidNonce({ idempotencyKey: "order-2", ...pinned })).not.toBe(
      first,
    )
  })

  it("signs a fresh nonce on every call without a key", async () => {
    expect(await paidNonce({})).not.toBe(await paidNonce({}))
  })

  it("keeps a random nonce for a zero-value challenge", async () => {
    const nonce = await paidNonce({ idempotencyKey: "order-1", ...pinned }, "0")
    expect(nonce).not.toBe(idempotencyNonce("order-1"))
  })

  it("rejects an empty key before signing", async () => {
    await expect(paidNonce({ idempotencyKey: "", ...pinned })).rejects.toThrow(
      "idempotencyKey must be a non-empty string",
    )
  })

  it.each([
    ["no allowedAssets", undefined],
    [
      "two allowedAssets",
      [requirements.asset, "0x036cbd53842c5426634e7929541ec2318f3dcf7e"],
    ],
  ])("rejects a key with %s, before any request", async (_label, allowedAssets) => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      paidFetch("https://tool.example.com/api", {
        signer,
        idempotencyKey: "order-1",
        allowedAssets,
      }),
    ).rejects.toThrow(
      "idempotencyKey requires allowedAssets with exactly one USDC contract",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("rejects a key pinned to a non-USDC asset, before any request", async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      paidFetch("https://tool.example.com/api", {
        signer,
        idempotencyKey: "order-1",
        allowedAssets: ["0x1111111111111111111111111111111111111111"],
      }),
    ).rejects.toThrow(
      "idempotencyKey requires allowedAssets with exactly one USDC contract",
    )
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it("refuses to sign when the challenge network is not the pinned USDC's", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            accepts: [{ ...requirements, network: "base-sepolia" }],
          }),
          { status: 402 },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)
    await expect(
      paidFetch("https://tool.example.com/api", {
        signer,
        idempotencyKey: "order-1",
        ...pinned,
      }),
    ).rejects.toThrow(
      "idempotencyKey covers USDC on the challenged network only",
    )
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
