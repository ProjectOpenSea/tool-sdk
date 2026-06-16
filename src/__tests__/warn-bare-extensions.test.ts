import { afterEach, describe, expect, it, vi } from "vitest"
import { warnBareExtensionKeys } from "../cli/commands/warn-bare-extensions.js"

const validManifest = {
  name: "nft-price-oracle",
  description: "Returns estimated floor price for any NFT collection.",
  endpoint: "https://tools.example.com/nft-price-oracle",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
}

describe("warnBareExtensionKeys", () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("stays silent for a clean manifest", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    warnBareExtensionKeys(validManifest)
    expect(warn).not.toHaveBeenCalled()
  })

  it("stays silent when extensions are namespaced", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    warnBareExtensionKeys({
      ...validManifest,
      "io.opensea.paymentHint": { tier: "gold" },
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it("warns and lists each bare extension field", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    warnBareExtensionKeys({
      ...validManifest,
      surprise: "value",
      anotherBareOne: 1,
    })
    expect(warn).toHaveBeenCalledOnce()
    const output = warn.mock.calls[0]?.[0] as string
    expect(output).toContain("un-namespaced extension")
    expect(output).toContain("surprise")
    expect(output).toContain("anotherBareOne")
    expect(output).toContain("reverse-DNS")
  })
})
