import { describe, expect, it } from "vitest"
import {
  parseX402Challenge,
  resolveNetwork,
} from "../lib/client/x402-challenge.js"

const USDC_BASE = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"

describe("resolveNetwork", () => {
  it("resolves short names", () => {
    expect(resolveNetwork("base")?.chainId).toBe(8453)
    expect(resolveNetwork("base-sepolia")?.chainId).toBe(84532)
  })

  it("resolves CAIP-2 and numeric forms", () => {
    expect(resolveNetwork("eip155:8453")?.chainId).toBe(8453)
    expect(resolveNetwork("8453")?.chainId).toBe(8453)
    expect(resolveNetwork("eip155:84532")?.canonical).toBe("base-sepolia")
  })

  it("returns undefined for unsupported networks", () => {
    expect(resolveNetwork("ethereum")).toBeUndefined()
    expect(resolveNetwork("eip155:1")).toBeUndefined()
  })

  it("maps each network to its canonical USDC address", () => {
    expect(resolveNetwork("eip155:8453")?.usdc.toLowerCase()).toBe(USDC_BASE)
  })
})

describe("parseX402Challenge", () => {
  it("parses a v1 challenge from the response body", async () => {
    const res = new Response(
      JSON.stringify({
        x402Version: 1,
        accepts: [
          {
            scheme: "exact",
            network: "base",
            maxAmountRequired: "10000",
            payTo: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
            asset: USDC_BASE,
          },
        ],
      }),
      { status: 402 },
    )

    const parsed = await parseX402Challenge(res)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.x402Version).toBe(1)
    expect(parsed.requirements.maxAmountRequired).toBe("10000")
    expect(parsed.requirements.network).toBe("base")
  })

  it("parses a v2 challenge from the PAYMENT-REQUIRED header with amount + CAIP-2 network", async () => {
    const challenge = {
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount: "6000",
          payTo: "0x9dba414637c611a16bea6f0796bfcbcbdc410df8",
          asset: USDC_BASE,
          extra: { name: "USD Coin", version: "2" },
        },
      ],
    }
    const header = Buffer.from(JSON.stringify(challenge)).toString("base64")
    const res = new Response("{}", {
      status: 402,
      headers: { "payment-required": header },
    })

    const parsed = await parseX402Challenge(res)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.x402Version).toBe(2)
    // v2 `amount` is normalized into `maxAmountRequired`.
    expect(parsed.requirements.maxAmountRequired).toBe("6000")
    expect(parsed.requirements.network).toBe("eip155:8453")
    expect(parsed.requirements.payTo).toBe(
      "0x9dba414637c611a16bea6f0796bfcbcbdc410df8",
    )
  })

  it("reports invalid base64 header", async () => {
    const res = new Response("{}", {
      status: 402,
      headers: { "payment-required": "!!!not-base64-json!!!" },
    })
    const parsed = await parseX402Challenge(res)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain("PAYMENT-REQUIRED header")
  })

  it("reports invalid JSON body", async () => {
    const res = new Response("not json", { status: 402 })
    const parsed = await parseX402Challenge(res)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain("not valid JSON")
  })

  it("reports missing accepts", async () => {
    const res = new Response(JSON.stringify({ x402Version: 1 }), {
      status: 402,
    })
    const parsed = await parseX402Challenge(res)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain("accepts is missing")
  })

  it("rejects a challenge missing payTo / asset", async () => {
    const res = new Response(
      JSON.stringify({
        x402Version: 1,
        accepts: [{ scheme: "exact", network: "base", maxAmountRequired: "1" }],
      }),
      { status: 402 },
    )
    const parsed = await parseX402Challenge(res)
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.reason).toContain("missing a payTo, asset, or amount")
  })
})
