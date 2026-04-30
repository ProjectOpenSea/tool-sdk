import { afterEach, describe, expect, it, vi } from "vitest"

const SAMPLE_MANIFEST = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "paid-tool",
  description: "A paid tool for testing",
  endpoint: "https://paid.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
  pricing: [
    {
      amount: "10000",
      asset: "eip155:8453/erc20:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      recipient: "eip155:8453:0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      protocol: "x402",
    },
  ],
}

vi.mock("../cli/commands/load-manifest.js", () => ({
  loadManifest: vi.fn(async () => SAMPLE_MANIFEST),
}))

afterEach(() => {
  vi.restoreAllMocks()
})

describe("dry-run-gate command", () => {
  it("asserts a 402 response with valid accepts shape", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {})

    const { dryRunGateCommand } = await import(
      "../cli/commands/dry-run-gate.js"
    )

    await dryRunGateCommand.parseAsync([
      "node",
      "dry-run-gate",
      "--manifest",
      "./src/manifest.ts",
      "--input",
      '{"query":"test"}',
    ])

    const output = logSpy.mock.calls.map(c => c[0]).join("\n")
    expect(output).toContain("402")
    expect(output).toContain("scheme")
    expect(output).toContain("network")
    expect(output).toContain("maxAmountRequired")
    expect(output).toContain("payTo")
    expect(output).toContain("asset")
    expect(output).toContain("All checks passed")

    logSpy.mockRestore()
  })

  it("fails when manifest has no pricing", async () => {
    const { loadManifest } = await import("../cli/commands/load-manifest.js")
    vi.mocked(loadManifest).mockResolvedValueOnce({
      ...SAMPLE_MANIFEST,
      pricing: [],
    })

    const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called")
    }) as never)
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    const { dryRunGateCommand } = await import(
      "../cli/commands/dry-run-gate.js"
    )

    try {
      await dryRunGateCommand.parseAsync([
        "node",
        "dry-run-gate",
        "--manifest",
        "./src/manifest.ts",
      ])
    } catch {
      // expected process.exit
    }

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("no pricing entries"),
    )

    exitSpy.mockRestore()
    errorSpy.mockRestore()
  })
})
