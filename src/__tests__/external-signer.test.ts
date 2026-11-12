import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createEip3009AuthHeader,
  eip3009AuthenticatedFetch,
} from "../lib/client/eip3009-auth.js"
import {
  createBankrAccount,
  createExternalSignerAccount,
} from "../lib/client/external-signer.js"
import { derivePredicateGateRecipient } from "../lib/predicate-gate-audience.js"
import type { ZeroValueAuthorization } from "../lib/usage/eip3009-auth.js"

const localAccount = privateKeyToAccount(generatePrivateKey())

afterEach(() => {
  vi.unstubAllGlobals()
})

const SAMPLE_AUTHORIZATION: ZeroValueAuthorization = {
  from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
  to: "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8",
  value: "0",
  validAfter: "1700000000",
  validBefore: "1700000300",
  nonce: "0x01",
  // ">" and "?" make standard base64 emit "+" and "/", and the JSON length
  // leaves "=" padding, so the base64url assertions below are not vacuous.
  signature: "0x>>>???",
  chainId: 8453,
}

describe("createEip3009AuthHeader", () => {
  it("produces EIP-3009 <base64url> format", () => {
    const header = createEip3009AuthHeader(SAMPLE_AUTHORIZATION)

    expect(header).toMatch(/^EIP-3009 [A-Za-z0-9_-]+$/)
    expect(header.startsWith("EIP-3009 ")).toBe(true)
  })

  it("base64url-encodes the authorization without padding", () => {
    const json = JSON.stringify(SAMPLE_AUTHORIZATION)
    const standard = Buffer.from(json, "utf-8").toString("base64")
    expect(standard).toMatch(/[+/=]/)

    const header = createEip3009AuthHeader(SAMPLE_AUTHORIZATION)
    const encoded = header.slice("EIP-3009 ".length)

    expect(encoded).not.toContain("+")
    expect(encoded).not.toContain("/")
    expect(encoded).not.toContain("=")
  })

  it("round-trips every authorization field through the encoded JSON", () => {
    const header = createEip3009AuthHeader(SAMPLE_AUTHORIZATION)
    const encoded = header.slice("EIP-3009 ".length)
    const decoded = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf-8"),
    )

    expect(decoded).toEqual(SAMPLE_AUTHORIZATION)
  })
})

describe("createExternalSignerAccount", () => {
  it("creates a viem Account with the given address", () => {
    const address = localAccount.address
    const account = createExternalSignerAccount({
      address,
      signMessage: async () => "0xdead" as `0x${string}`,
    })

    expect(account.address).toBe(address)
    expect(account.type).toBe("local")
  })

  it("delegates signMessage to the provided function", async () => {
    const expectedSig = "0xabcdef1234" as `0x${string}`
    const signMessage = vi.fn(async () => expectedSig)

    const account = createExternalSignerAccount({
      address: localAccount.address,
      signMessage,
    })

    const result = await account.signMessage!({ message: "hello" })

    expect(signMessage).toHaveBeenCalledWith("hello")
    expect(result).toBe(expectedSig)
  })

  it("throws on non-string messages (raw bytes)", async () => {
    const account = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async () => "0xdead" as `0x${string}`,
    })

    await expect(
      account.signMessage!({ message: { raw: new Uint8Array([1, 2, 3]) } }),
    ).rejects.toThrow("only supports string messages")
  })

  it("throws on signTransaction since it is unsupported", async () => {
    const account = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async () => "0xdead" as `0x${string}`,
    })

    await expect(account.signTransaction!({})).rejects.toThrow(
      "does not support signTransaction",
    )
  })

  it("delegates signTypedData when provided", async () => {
    const expectedSig = "0xtyped" as `0x${string}`
    const signTypedData = vi.fn(async () => expectedSig)

    const account = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async () => "0xdead" as `0x${string}`,
      signTypedData,
    })

    const result = await account.signTypedData!({
      domain: {},
      types: {},
      primaryType: "EIP712Domain",
    } as Parameters<NonNullable<typeof account.signTypedData>>[0])

    expect(signTypedData).toHaveBeenCalled()
    expect(result).toBe(expectedSig)
  })

  it("throws on signTypedData when not provided", async () => {
    const account = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async () => "0xdead" as `0x${string}`,
    })

    await expect(
      account.signTypedData!({
        domain: {},
        types: {},
        primaryType: "EIP712Domain",
      } as Parameters<NonNullable<typeof account.signTypedData>>[0]),
    ).rejects.toThrow("signTypedData not provided")
  })
})

describe("external signer + eip3009AuthenticatedFetch round-trip", () => {
  it("signs a valid X-Payment through the external signTypedData", async () => {
    const TOOL_URL = "https://tool.example.com/api"
    const OPERATOR = "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as const
    const TOOL_ID = 42n
    const payTo = derivePredicateGateRecipient({
      audience: TOOL_URL,
      toolId: TOOL_ID,
      operatorAddress: OPERATOR,
    })

    // Simulate an external signer by using a local key under the hood
    const signTypedData = vi.fn(async (typedData: unknown) =>
      localAccount.signTypedData(
        typedData as Parameters<typeof localAccount.signTypedData>[0],
      ),
    )
    const externalAccount = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async message => localAccount.signMessage({ message }),
      signTypedData,
    })

    const capturedInits: RequestInit[] = []
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInits.push(init ?? {})
        if (capturedInits.length === 1) {
          return new Response(
            JSON.stringify({
              x402Version: 1,
              accepts: [
                {
                  scheme: "exact",
                  network: "base",
                  maxAmountRequired: "0",
                  payTo,
                  asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                  extra: {
                    name: "USD Coin",
                    version: "2",
                    predicateGate: {
                      toolId: TOOL_ID.toString(),
                      operatorAddress: OPERATOR,
                    },
                  },
                },
              ],
            }),
            { status: 402 },
          )
        }
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const res = await eip3009AuthenticatedFetch(TOOL_URL, {
      account: externalAccount,
      method: "POST",
      body: JSON.stringify({ query: "test" }),
    })

    expect(res.status).toBe(200)
    expect(signTypedData).toHaveBeenCalledOnce()

    const xPayment = new Headers(capturedInits[1]?.headers).get("X-Payment")
    expect(xPayment).toBeTruthy()
    const payment = JSON.parse(
      Buffer.from(xPayment!, "base64").toString("utf-8"),
    )
    const authorization = payment.payload.authorization
    expect(authorization.from.toLowerCase()).toBe(
      localAccount.address.toLowerCase(),
    )
    expect(authorization.to.toLowerCase()).toBe(payTo.toLowerCase())
    expect(authorization.value).toBe("0")
    expect(payment.payload.signature).toMatch(/^0x[0-9a-f]+$/i)
  })
})

const BANKR_ADDRESS = "0x8b8e1C20E0630De8C60f0e0D5C3e9C7c20F0c20e"

describe("createBankrAccount", () => {
  it("fetches address from /wallet/me and creates a signing account", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/wallet/me")) {
        return new Response(
          JSON.stringify({
            success: true,
            wallets: [
              { chain: "evm", address: BANKR_ADDRESS },
              { chain: "solana", address: "5DcKsomeSolanaAddress" },
            ],
          }),
          { status: 200 },
        )
      }
      if (url.includes("/wallet/sign")) {
        return new Response(JSON.stringify({ signature: "0xdeadbeef" }), {
          status: 200,
        })
      }
      return new Response("not found", { status: 404 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const account = await createBankrAccount("test-api-key")

    expect(account.address.toLowerCase()).toBe(BANKR_ADDRESS.toLowerCase())

    const sig = await account.signMessage!({ message: "hello" })
    expect(sig).toBe("0xdeadbeef")

    // Verify /wallet/me was called with API key header
    const infoCall = fetchMock.mock.calls[0]
    expect(infoCall[0]).toContain("/wallet/me")
    expect(infoCall[1]?.headers).toEqual(
      expect.objectContaining({ "X-API-Key": "test-api-key" }),
    )

    // Verify /wallet/sign was called with correct payload
    const signCall = fetchMock.mock.calls[1]
    expect(signCall[0]).toContain("/wallet/sign")
    const signBody = JSON.parse(signCall[1]?.body as string)
    expect(signBody.signatureType).toBe("personal_sign")
    expect(signBody.message).toBe("hello")
  })

  it("throws when /wallet/me returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    )

    await expect(createBankrAccount("bad-key")).rejects.toThrow(
      "Bankr /wallet/me failed (401)",
    )
  })

  it("throws when /wallet/me returns no EVM wallet", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: true,
              wallets: [{ chain: "solana", address: "5DcKsomeSolanaAddress" }],
            }),
            { status: 200 },
          ),
      ),
    )

    await expect(createBankrAccount("test-key")).rejects.toThrow(
      "Bankr /wallet/me returned no EVM wallet address",
    )
  })

  it("throws when /wallet/sign returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wallet/me")) {
          return new Response(
            JSON.stringify({
              success: true,
              wallets: [{ chain: "evm", address: BANKR_ADDRESS }],
            }),
            { status: 200 },
          )
        }
        return new Response("Rate limited", { status: 429 })
      }),
    )

    const account = await createBankrAccount("test-key")

    await expect(account.signMessage!({ message: "hello" })).rejects.toThrow(
      "Bankr /wallet/sign failed (429)",
    )
  })
})
