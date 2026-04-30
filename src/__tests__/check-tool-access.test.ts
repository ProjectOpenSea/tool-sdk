import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const TEST_TOOL_ID = 7n
const TEST_ACCOUNT = "0xabcdefabcdef1234567890abcdefabcdef123456" as const

const mockTryHasAccess = vi.fn(async () => ({ ok: true, granted: true }))

vi.mock("../lib/onchain/registry.js", () => ({
  ToolRegistryClient: class {
    tryHasAccess = mockTryHasAccess
  },
}))

beforeEach(() => {
  mockTryHasAccess.mockReset()
  mockTryHasAccess.mockResolvedValue({ ok: true, granted: true })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe("checkToolAccess", () => {
  it("returns { ok: true, granted: true } when the predicate grants access", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { checkToolAccess } = await import("../lib/onchain/access.js")

    const result = await checkToolAccess({
      toolId: TEST_TOOL_ID,
      account: TEST_ACCOUNT,
    })

    expect(result).toEqual({ ok: true, granted: true })
    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      TEST_ACCOUNT,
      "0x",
    )
  })

  it("returns { ok: true, granted: false } when the predicate denies access", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: false })
    const { checkToolAccess } = await import("../lib/onchain/access.js")

    const result = await checkToolAccess({
      toolId: TEST_TOOL_ID,
      account: TEST_ACCOUNT,
    })

    expect(result).toEqual({ ok: true, granted: false })
  })

  it("returns { ok: false, granted: false } when the predicate misbehaves", async () => {
    mockTryHasAccess.mockResolvedValueOnce({ ok: false, granted: false })
    const { checkToolAccess } = await import("../lib/onchain/access.js")

    const result = await checkToolAccess({
      toolId: TEST_TOOL_ID,
      account: TEST_ACCOUNT,
    })

    expect(result).toEqual({ ok: false, granted: false })
  })

  it("forwards the configured `data` argument to tryHasAccess", async () => {
    const customData = "0xc0ffee" as const
    mockTryHasAccess.mockResolvedValueOnce({ ok: true, granted: true })
    const { checkToolAccess } = await import("../lib/onchain/access.js")

    await checkToolAccess({
      toolId: TEST_TOOL_ID,
      account: TEST_ACCOUNT,
      data: customData,
    })

    expect(mockTryHasAccess).toHaveBeenCalledWith(
      TEST_TOOL_ID,
      TEST_ACCOUNT,
      customData,
    )
  })
})
