import { base } from "viem/chains"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { resolveRpcUrl } from "../cli/commands/shared.js"

describe("resolveRpcUrl", () => {
  const originalRpcUrl = process.env.RPC_URL

  beforeEach(() => {
    delete process.env.RPC_URL
  })

  afterEach(() => {
    if (originalRpcUrl === undefined) {
      delete process.env.RPC_URL
    } else {
      process.env.RPC_URL = originalRpcUrl
    }
    vi.restoreAllMocks()
  })

  it("prefers the --rpc-url flag over everything else", () => {
    process.env.RPC_URL = "https://env.example.com"
    const wallet = { getRpcUrl: () => "https://wallet.example.com" }
    expect(resolveRpcUrl("https://flag.example.com", wallet, base)).toBe(
      "https://flag.example.com",
    )
  })

  it("falls back to the wallet-provided RPC URL", () => {
    process.env.RPC_URL = "https://env.example.com"
    const wallet = { getRpcUrl: () => "https://wallet.example.com" }
    expect(resolveRpcUrl(undefined, wallet, base)).toBe(
      "https://wallet.example.com",
    )
  })

  it("falls back to the RPC_URL env var when the wallet has no RPC URL", () => {
    process.env.RPC_URL = "https://env.example.com"
    const wallet = {} // e.g. Bankr adapter — no getRpcUrl
    expect(resolveRpcUrl(undefined, wallet, base)).toBe(
      "https://env.example.com",
    )
  })

  it("falls back to RPC_URL env var without a wallet", () => {
    process.env.RPC_URL = "https://env.example.com"
    expect(resolveRpcUrl(undefined, undefined, base)).toBe(
      "https://env.example.com",
    )
  })

  it("returns undefined and warns when nothing is configured", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    expect(resolveRpcUrl(undefined, undefined, base)).toBeUndefined()
    expect(log).toHaveBeenCalledTimes(1)
    const message = log.mock.calls[0][0] as string
    expect(message).toContain("default public RPC")
    expect(message).toContain(base.rpcUrls.default.http[0])
    expect(message).toContain("--rpc-url")
    expect(message).toContain("RPC_URL")
  })

  it("does not warn when an RPC URL is resolved", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {})
    resolveRpcUrl("https://flag.example.com", undefined, base)
    expect(log).not.toHaveBeenCalled()
  })
})
