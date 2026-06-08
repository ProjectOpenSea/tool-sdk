import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { afterEach, describe, expect, it, vi } from "vitest"
import { signZeroValueAuthorization } from "../lib/usage/eip3009-auth.js"

vi.mock("viem", async importOriginal => {
  const actual = (await importOriginal()) as Record<string, unknown>
  return { ...actual }
})

function mockWalletClient(
  overrides: { address?: `0x${string}`; signature?: `0x${string}` } = {},
) {
  const address =
    overrides.address ?? "0xabcdefabcdef1234567890abcdefabcdef12345678"
  const signature =
    overrides.signature ??
    "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef00"
  return {
    account: { address },
    signTypedData: vi.fn().mockResolvedValue(signature),
  } as unknown as Parameters<
    typeof signZeroValueAuthorization
  >[0]["walletClient"]
}

describe("signZeroValueAuthorization", () => {
  it("returns a zero-value authorization with correct fields", async () => {
    const client = mockWalletClient()
    const result = await signZeroValueAuthorization({
      walletClient: client,
      from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
      to: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
    })

    expect(result.value).toBe("0")
    const validAfter = Number(result.validAfter)
    const nowSec = Math.floor(Date.now() / 1000)
    expect(validAfter).toBeGreaterThanOrEqual(nowSec - 62)
    expect(validAfter).toBeLessThanOrEqual(nowSec - 58)
    const validBefore = Number(result.validBefore)
    expect(validBefore).toBeGreaterThan(nowSec)
    expect(validBefore).toBeLessThanOrEqual(nowSec + 300)
    expect(result.from).toBe("0xabcdefabcdef1234567890abcdefabcdef12345678")
    expect(result.to).toBe("0x0000000000000000000000000000000000000000")
    expect(result.chainId).toBe(8453)
    expect(result.signature).toMatch(/^0x/)
    expect(result.nonce).toMatch(/^0x/)
  })

  it("uses Base USDC address by default for chainId 8453", async () => {
    const client = mockWalletClient()
    const signSpy = (
      client as unknown as { signTypedData: ReturnType<typeof vi.fn> }
    ).signTypedData

    await signZeroValueAuthorization({
      walletClient: client,
      from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
      to: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
    })

    const callArgs = signSpy.mock.calls[0]![0]
    expect(callArgs.domain.verifyingContract).toBe(
      "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
    )
  })

  it("uses explicit tokenAddress when provided", async () => {
    const client = mockWalletClient()
    const signSpy = (
      client as unknown as { signTypedData: ReturnType<typeof vi.fn> }
    ).signTypedData
    const customToken =
      "0x1111111111111111111111111111111111111111" as `0x${string}`

    await signZeroValueAuthorization({
      walletClient: client,
      from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
      to: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
      tokenAddress: customToken,
    })

    const callArgs = signSpy.mock.calls[0]![0]
    expect(callArgs.domain.verifyingContract).toBe(customToken)
  })

  it("throws for unknown chainId without tokenAddress", async () => {
    const client = mockWalletClient()

    await expect(
      signZeroValueAuthorization({
        walletClient: client,
        from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
        to: "0x0000000000000000000000000000000000000000",
        chainId: 999999,
      }),
    ).rejects.toThrow("No USDC token address known for chainId 999999")
  })

  it("throws when walletClient has no account", async () => {
    const client = { signTypedData: vi.fn() } as unknown as Parameters<
      typeof signZeroValueAuthorization
    >[0]["walletClient"]

    await expect(
      signZeroValueAuthorization({
        walletClient: client,
        from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
        to: "0x0000000000000000000000000000000000000000",
        chainId: 8453,
      }),
    ).rejects.toThrow("walletClient must have an account")
  })

  it("signs with EIP-712 TransferWithAuthorization types", async () => {
    const client = mockWalletClient()
    const signSpy = (
      client as unknown as { signTypedData: ReturnType<typeof vi.fn> }
    ).signTypedData

    await signZeroValueAuthorization({
      walletClient: client,
      from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
      to: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
    })

    expect(signSpy).toHaveBeenCalledOnce()
    const callArgs = signSpy.mock.calls[0]![0]
    expect(callArgs.primaryType).toBe("TransferWithAuthorization")
    expect(callArgs.domain.name).toBe("USD Coin")
    expect(callArgs.domain.version).toBe("2")
    expect(callArgs.domain.chainId).toBe(8453)
    expect(callArgs.message.value).toBe(0n)
    const validAfterBigInt = callArgs.message.validAfter as bigint
    const nowSec = Math.floor(Date.now() / 1000)
    expect(Number(validAfterBigInt)).toBeGreaterThanOrEqual(nowSec - 62)
    expect(Number(validAfterBigInt)).toBeLessThanOrEqual(nowSec - 58)
  })

  it("generates a unique nonce per call", async () => {
    const client = mockWalletClient()

    const result1 = await signZeroValueAuthorization({
      walletClient: client,
      from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
      to: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
    })
    const result2 = await signZeroValueAuthorization({
      walletClient: client,
      from: "0xabcdefabcdef1234567890abcdefabcdef12345678",
      to: "0x0000000000000000000000000000000000000000",
      chainId: 8453,
    })

    expect(result1.nonce).not.toBe(result2.nonce)
  })
})

describe("eip3009AuthenticatedFetch", () => {
  const account = privateKeyToAccount(generatePrivateKey())
  const OPERATOR = "0x5ECA0441311643608a8c9Ab8B250f695Dd32E2a8" as const

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it("retries with X-Payment from 402 challenge", async () => {
    let callCount = 0
    const capturedInits: RequestInit[] = []
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInits.push(init ?? {})
      callCount++
      if (callCount === 1) {
        return new Response(
          JSON.stringify({
            x402Version: 1,
            error: "X-PAYMENT header is required",
            accepts: [
              {
                scheme: "exact",
                network: "base",
                maxAmountRequired: "0",
                payTo: OPERATOR,
                asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                extra: { name: "USD Coin", version: "2" },
              },
            ],
          }),
          { status: 402 },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    const { eip3009AuthenticatedFetch } = await import(
      "../lib/client/eip3009-auth.js"
    )

    const res = await eip3009AuthenticatedFetch(
      "https://tool.example.com/api",
      { account, method: "POST", body: "{}" },
    )

    expect(res.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // First call has no auth headers
    const firstHeaders = new Headers(capturedInits[0].headers)
    expect(firstHeaders.get("Authorization")).toBeNull()
    expect(firstHeaders.get("X-Payment")).toBeNull()

    // Second call has X-Payment only
    const secondHeaders = new Headers(capturedInits[1].headers)
    expect(secondHeaders.get("Authorization")).toBeNull()
    expect(secondHeaders.get("X-Payment")).toBeTruthy()
  })

  it("throws when payTo is not in allowedRecipients", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            x402Version: 1,
            accepts: [
              {
                scheme: "exact",
                network: "base",
                maxAmountRequired: "0",
                payTo: "0xDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEfDeAdBeEf",
                asset: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
                extra: { name: "USD Coin", version: "2" },
              },
            ],
          }),
          { status: 402 },
        ),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { eip3009AuthenticatedFetch } = await import(
      "../lib/client/eip3009-auth.js"
    )

    await expect(
      eip3009AuthenticatedFetch("https://tool.example.com/api", {
        account,
        method: "POST",
        body: "{}",
        allowedRecipients: [OPERATOR],
      }),
    ).rejects.toThrow(/not in allowedRecipients/)
  })

  it("returns 402 as-is when no accepts in challenge body", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "payment required" }), {
          status: 402,
        }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const { eip3009AuthenticatedFetch } = await import(
      "../lib/client/eip3009-auth.js"
    )

    const res = await eip3009AuthenticatedFetch(
      "https://tool.example.com/api",
      { account },
    )

    expect(res.status).toBe(402)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
