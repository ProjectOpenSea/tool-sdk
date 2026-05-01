import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { parseSiweMessage } from "viem/siwe"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  createBankrAccount,
  createExternalSignerAccount,
} from "../lib/client/external-signer.js"
import {
  authenticatedFetch,
  createSiweAuthHeader,
} from "../lib/client/siwe-auth.js"
import type { ToolContext } from "../types.js"

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

const localAccount = privateKeyToAccount(generatePrivateKey())

afterEach(() => {
  vi.unstubAllGlobals()
  mockReadContract.mockClear()
  mockVerifySiweMessage.mockClear()
})

describe("createSiweAuthHeader", () => {
  it("produces SIWE <base64url>.<signature> format", () => {
    const message =
      "example.com wants you to sign in with your Ethereum account"
    const signature =
      "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as `0x${string}`

    const header = createSiweAuthHeader(message, signature)

    expect(header).toMatch(/^SIWE .+\..+$/)
    expect(header.startsWith("SIWE ")).toBe(true)
  })

  it("base64url-encodes the message without padding", () => {
    const message = "test message with special chars: +/="
    const signature = "0xabc123" as `0x${string}`

    const header = createSiweAuthHeader(message, signature)
    const token = header.slice(5)
    const dotIndex = token.lastIndexOf(".")
    const encodedMessage = token.slice(0, dotIndex)

    expect(encodedMessage).not.toContain("+")
    expect(encodedMessage).not.toContain("/")
    expect(encodedMessage).not.toContain("=")

    const decoded = Buffer.from(encodedMessage, "base64url").toString("utf-8")
    expect(decoded).toBe(message)
  })

  it("appends the signature after the dot separator", () => {
    const message = "hello"
    const signature = "0xdeadbeef" as `0x${string}`

    const header = createSiweAuthHeader(message, signature)
    const token = header.slice(5)
    const dotIndex = token.lastIndexOf(".")
    const sig = token.slice(dotIndex + 1)

    expect(sig).toBe(signature)
  })

  it("matches the format produced by authenticatedFetch", async () => {
    let capturedAuth: string | null = null
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedAuth = new Headers(init?.headers).get("Authorization")
        return new Response("ok", { status: 200 })
      }),
    )

    await authenticatedFetch("https://example.com/api", {
      account: localAccount,
    })

    expect(capturedAuth).toBeTruthy()
    expect(capturedAuth).toMatch(/^SIWE .+\..+$/)

    // Verify the header can be decoded back to a valid SIWE message
    const token = capturedAuth!.slice(5)
    const dotIndex = token.lastIndexOf(".")
    const messageB64 = token.slice(0, dotIndex)
    const decoded = Buffer.from(messageB64, "base64url").toString("utf-8")
    const parsed = parseSiweMessage(decoded)
    expect(parsed.address).toBe(localAccount.address)
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

describe("external signer + authenticatedFetch round-trip", () => {
  it("works with authenticatedFetch to produce a valid SIWE auth header", async () => {
    // Simulate an external signer by using a local key under the hood
    const externalAccount = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async message => {
        return localAccount.signMessage({ message })
      },
    })

    let capturedInit: RequestInit | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    const res = await authenticatedFetch("https://tool.example.com/api", {
      account: externalAccount,
      method: "POST",
      body: JSON.stringify({ query: "test" }),
    })

    expect(res.status).toBe(200)

    const headers = new Headers(capturedInit?.headers)
    const authHeader = headers.get("Authorization")
    expect(authHeader).toMatch(/^SIWE .+\..+$/)

    // Decode and verify the SIWE message
    const token = authHeader!.slice(5)
    const dotIndex = token.lastIndexOf(".")
    const messageB64 = token.slice(0, dotIndex)
    const signature = token.slice(dotIndex + 1)

    const messageStr = Buffer.from(messageB64, "base64url").toString("utf-8")
    const parsed = parseSiweMessage(messageStr)
    expect(parsed.address).toBe(localAccount.address)
    expect(parsed.domain).toBe("tool.example.com")
    expect(signature).toMatch(/^0x[0-9a-f]+$/i)
  })

  it("round-trips with nftGate middleware (same auth format as predicateGate)", async () => {
    const { nftGate } = await import("../lib/middleware/nft-gate.js")

    const externalAccount = createExternalSignerAccount({
      address: localAccount.address,
      signMessage: async message => {
        return localAccount.signMessage({ message })
      },
    })

    let capturedRequest: Request | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        capturedRequest = new Request(url, init)
        return new Response(JSON.stringify({ ok: true }), { status: 200 })
      }),
    )

    await authenticatedFetch("https://example.com/api", {
      account: externalAccount,
    })

    expect(capturedRequest).toBeTruthy()

    const gate = nftGate({
      collection: "0x1234567890abcdef1234567890abcdef12345678",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const gateResult = await gate.check(capturedRequest!, ctx)

    expect(gateResult).toBeNull()
    expect(ctx.callerAddress).toBe(localAccount.address)
  })
})

const BANKR_ADDRESS = "0x8b8e1C20E0630De8C60f0e0D5C3e9C7c20F0c20e"

describe("createBankrAccount", () => {
  it("fetches address from /wallet/info and creates a signing account", async () => {
    const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
      if (url.includes("/wallet/info")) {
        return new Response(JSON.stringify({ address: BANKR_ADDRESS }), {
          status: 200,
        })
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

    // Verify /wallet/info was called with API key header
    const infoCall = fetchMock.mock.calls[0]
    expect(infoCall[0]).toContain("/wallet/info")
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

  it("throws when /wallet/info returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Unauthorized", { status: 401 })),
    )

    await expect(createBankrAccount("bad-key")).rejects.toThrow(
      "Bankr /wallet/info failed (401)",
    )
  })

  it("throws when /wallet/sign returns an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (typeof url === "string" && url.includes("/wallet/info")) {
          return new Response(JSON.stringify({ address: BANKR_ADDRESS }), {
            status: 200,
          })
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
