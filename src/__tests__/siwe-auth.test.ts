import { generatePrivateKey, privateKeyToAccount } from "viem/accounts"
import { parseSiweMessage } from "viem/siwe"
import { afterEach, describe, expect, it, vi } from "vitest"
import {
  authenticatedFetch,
  createSiweMessage,
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

const account = privateKeyToAccount(generatePrivateKey())

afterEach(() => {
  vi.unstubAllGlobals()
  mockReadContract.mockClear()
  mockVerifySiweMessage.mockClear()
})

describe("createSiweMessage", () => {
  it("produces valid EIP-4361 format parseable by parseSiweMessage", () => {
    const message = createSiweMessage({
      account,
      domain: "my-tool.vercel.app",
      uri: "https://my-tool.vercel.app/api/invoke",
    })

    const parsed = parseSiweMessage(message)
    expect(parsed.address).toBe(account.address)
    expect(parsed.domain).toBe("my-tool.vercel.app")
    expect(parsed.uri).toBe("https://my-tool.vercel.app/api/invoke")
    expect(parsed.version).toBe("1")
    expect(parsed.chainId).toBe(8453)
    expect(parsed.statement).toBe("Authenticate to access this tool")
    expect(parsed.nonce).toBeTruthy()
    expect(parsed.issuedAt).toBeInstanceOf(Date)
    expect(parsed.expirationTime).toBeInstanceOf(Date)
  })

  it("defaults expiration to 5 minutes from now", () => {
    const before = Date.now()
    const message = createSiweMessage({
      account,
      domain: "example.com",
      uri: "https://example.com/api",
    })
    const after = Date.now()

    const parsed = parseSiweMessage(message)
    const expTime = parsed.expirationTime!.getTime()

    expect(expTime).toBeGreaterThanOrEqual(before + 5 * 60_000 - 1000)
    expect(expTime).toBeLessThanOrEqual(after + 5 * 60_000 + 1000)
  })

  it("throws when expirationMinutes exceeds 60", () => {
    expect(() =>
      createSiweMessage({
        account,
        domain: "example.com",
        uri: "https://example.com/api",
        expirationMinutes: 61,
      }),
    ).toThrow("expirationMinutes must be ≤ 60")
  })

  it("accepts custom statement, expirationMinutes, chainId, and nonce", () => {
    const message = createSiweMessage({
      account,
      domain: "example.com",
      uri: "https://example.com/api",
      statement: "Custom statement",
      expirationMinutes: 10,
      chainId: 1,
      nonce: "customnonce12345678",
    })

    const parsed = parseSiweMessage(message)
    expect(parsed.statement).toBe("Custom statement")
    expect(parsed.chainId).toBe(1)
    expect(parsed.nonce).toBe("customnonce12345678")

    const expMinutes =
      (parsed.expirationTime!.getTime() - parsed.issuedAt!.getTime()) / 60_000
    expect(expMinutes).toBeCloseTo(10, 0)
  })
})

describe("authenticatedFetch", () => {
  it("adds Authorization: SIWE header in correct base64url.signature format", async () => {
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await authenticatedFetch("https://my-tool.vercel.app/api/invoke", {
      method: "POST",
      body: JSON.stringify({ query: "test" }),
      account,
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const headers = new Headers(capturedInit?.headers)
    const authHeader = headers.get("Authorization")

    expect(authHeader).toBeTruthy()
    expect(authHeader).toMatch(/^SIWE .+\..+$/)

    const token = authHeader!.slice(5)
    const dotIndex = token.lastIndexOf(".")
    const messageB64 = token.slice(0, dotIndex)
    const signature = token.slice(dotIndex + 1)

    const messageStr = Buffer.from(messageB64, "base64url").toString("utf-8")
    const parsed = parseSiweMessage(messageStr)
    expect(parsed.address).toBe(account.address)
    expect(parsed.domain).toBe("my-tool.vercel.app")
    expect(parsed.uri).toBe("https://my-tool.vercel.app/api/invoke")
    expect(signature).toMatch(/^0x[0-9a-f]+$/i)
  })

  it("returns the response from fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ result: "ok" }), { status: 200 }),
      ),
    )

    const res = await authenticatedFetch(
      "https://my-tool.vercel.app/api/invoke",
      { account },
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.result).toBe("ok")
  })

  it("does not retry on 401 or 403", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "forbidden" }), { status: 403 }),
    )
    vi.stubGlobal("fetch", fetchMock)

    const res = await authenticatedFetch(
      "https://my-tool.vercel.app/api/invoke",
      { account },
    )
    expect(res.status).toBe(403)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("preserves existing headers alongside Authorization", async () => {
    let capturedInit: RequestInit | undefined
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init
      return new Response("ok", { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await authenticatedFetch("https://example.com/api", {
      account,
      headers: { "Content-Type": "application/json", "X-Custom": "value" },
    })

    const headers = new Headers(capturedInit?.headers)
    expect(headers.get("Content-Type")).toBe("application/json")
    expect(headers.get("X-Custom")).toBe("value")
    expect(headers.get("Authorization")).toMatch(/^SIWE /)
  })

  it("round-trips with SIWE gate middleware (nftGate; same auth format as predicateGate)", async () => {
    const { nftGate } = await import("../lib/middleware/nft-gate.js")

    let capturedRequest: Request | undefined
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedRequest = new Request(url, init)
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)

    await authenticatedFetch("https://example.com/api", { account })

    expect(capturedRequest).toBeTruthy()

    const gate = nftGate({
      collection: "0x1234567890abcdef1234567890abcdef12345678",
    })
    const ctx: Partial<ToolContext> = { gates: {} }
    const gateResult = await gate.check(capturedRequest!, ctx)

    expect(gateResult).toBeNull()
    expect(ctx.callerAddress).toBe(account.address)
  })
})
