import { describe, expect, it, vi } from "vitest"
import { z } from "zod/v4"
import { ToolHandlerError } from "../index.js"
import { extractSettlementTxHash } from "../lib/client/x402-payment.js"
import { createToolHandler } from "../lib/handler/index.js"
import type { ManifestDefinition } from "../lib/manifest/index.js"
import type { Eip3009UsageReporterConfig } from "../lib/usage/eip3009-reporter.js"
import { createEip3009UsageReporter } from "../lib/usage/eip3009-reporter.js"
import type { GateMiddleware, InvocationEvent } from "../types.js"

vi.mock("../lib/usage/eip3009-reporter.js", () => ({
  createEip3009UsageReporter: vi.fn((_config: Eip3009UsageReporterConfig) => {
    return vi.fn().mockResolvedValue(undefined)
  }),
}))

const testManifest = {
  type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
} as ManifestDefinition

const InputSchema = z.object({ query: z.string() })
const OutputSchema = z.object({ result: z.string() })

function makeHandler(gates?: GateMiddleware[]) {
  return createToolHandler({
    manifest: testManifest,
    inputSchema: InputSchema,
    outputSchema: OutputSchema,
    gates,
    handler: async input => ({
      result: `Echo: ${input.query}`,
    }),
  })
}

function makeDynamicManifest(options: {
  callCount: { value: number }
  failFirst?: boolean
}): ManifestDefinition {
  return {
    type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
    name: "dynamic-tool",
    description: "A tool with dynamic manifest fields",
    endpoint: env => {
      options.callCount.value++
      if (options.failFirst && options.callCount.value === 1) {
        throw new Error("manifest resolution failed")
      }
      return env.TOOL_ENDPOINT ?? "https://dynamic.example.com"
    },
    inputs: {},
    outputs: {},
    creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
  }
}

describe("createToolHandler", () => {
  it("should return 405 for non-POST", async () => {
    const handler = makeHandler()
    const request = new Request("https://test.example.com/api", {
      method: "GET",
    })
    const response = await handler(request)
    expect(response.status).toBe(405)
  })

  it("should return 400 for invalid JSON body", async () => {
    const handler = makeHandler()
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: "not-json",
    })
    const response = await handler(request)
    expect(response.status).toBe(400)
  })

  it("should return 400 for invalid input", async () => {
    const handler = makeHandler()
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ wrong: "field" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.error).toBe("Invalid input")
  })

  it("should return 200 for valid input", async () => {
    const handler = makeHandler()
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "hello" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result).toBe("Echo: hello")
  })

  it("should cache a resolved manifest after the first successful request", async () => {
    const callCount = { value: 0 }
    const handler = createToolHandler({
      manifest: makeDynamicManifest({ callCount }),
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({
        result: `Echo: ${input.query}`,
      }),
    })
    const makeRequest = () =>
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "hello" }),
      })

    const first = await handler(makeRequest())
    const second = await handler(makeRequest())

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(callCount.value).toBe(1)
  })

  it("should retry manifest resolution after a failure", async () => {
    const callCount = { value: 0 }
    const handler = createToolHandler({
      manifest: makeDynamicManifest({ callCount, failFirst: true }),
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({
        result: `Echo: ${input.query}`,
      }),
    })
    const makeRequest = () =>
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: "hello" }),
      })

    const first = await handler(makeRequest())
    const second = await handler(makeRequest())

    expect(first.status).toBe(500)
    expect(second.status).toBe(200)
    expect(callCount.value).toBe(2)
  })

  it("should run gates in order and short-circuit on response", async () => {
    const order: string[] = []
    const gate1: GateMiddleware = {
      async check() {
        order.push("gate1")
        return null
      },
    }
    const gate2: GateMiddleware = {
      async check() {
        order.push("gate2")
        return Response.json({ error: "Blocked" }, { status: 403 })
      },
    }
    const gate3: GateMiddleware = {
      async check() {
        order.push("gate3")
        return null
      },
    }

    const handler = makeHandler([gate1, gate2, gate3])
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(403)
    expect(order).toEqual(["gate1", "gate2"])
  })

  it("should return the status and message from a ToolHandlerError", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async () => {
        throw new ToolHandlerError(502, "upstream error")
      },
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(502)
    const body = await response.json()
    expect(body).toEqual({ error: "upstream error" })
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] tool handler error:",
      expect.any(ToolHandlerError),
    )
    errorSpy.mockRestore()
  })

  it("should reject invalid HTTP status codes in ToolHandlerError", () => {
    expect(() => new ToolHandlerError(0, "bad")).toThrow(RangeError)
    expect(() => new ToolHandlerError(99, "bad")).toThrow(RangeError)
    expect(() => new ToolHandlerError(600, "bad")).toThrow(RangeError)
    expect(() => new ToolHandlerError(100, "ok")).not.toThrow()
    expect(() => new ToolHandlerError(599, "ok")).not.toThrow()
  })

  it("should return 500 with generic message for plain errors", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async () => {
        throw new Error("something broke")
      },
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: "Internal tool error" })
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] unhandled error in tool handler:",
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it("calls gate.settle() after handler succeeds and output validates", async () => {
    const order: string[] = []
    const gate: GateMiddleware = {
      async check() {
        order.push("check")
        return null
      },
      async settle() {
        order.push("settle")
      },
    }
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [gate],
      handler: async input => {
        order.push("handler")
        return { result: `Echo: ${input.query}` }
      },
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(200)
    expect(order).toEqual(["check", "handler", "settle"])
  })

  const TX_HASH =
    "0xabababababababababababababababababababababababababababababababab"

  function makeSettlingHandler() {
    const gate: GateMiddleware = {
      async check() {
        return null
      },
      async settle(ctx) {
        ctx.gates.x402 = {
          paid: true,
          payer: "0xpayer",
          settlementTxHash: TX_HASH,
        }
      },
    }
    return createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [gate],
      handler: async input => ({ result: `Echo: ${input.query}` }),
    })
  }

  it("emits an X-PAYMENT-RESPONSE settlement header on a settled v1 call", async () => {
    const handler = makeSettlingHandler()
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-PAYMENT": "..." },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(200)
    // The caller's own extractor must be able to read it back.
    expect(extractSettlementTxHash(response)).toBe(TX_HASH)
    expect(response.headers.get("X-PAYMENT-RESPONSE")).not.toBeNull()
    expect(response.headers.get("PAYMENT-RESPONSE")).toBeNull()
  })

  it("emits a PAYMENT-RESPONSE settlement header on a settled v2 call", async () => {
    const handler = makeSettlingHandler()
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "PAYMENT-SIGNATURE": "...",
      },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(200)
    expect(extractSettlementTxHash(response)).toBe(TX_HASH)
    expect(response.headers.get("PAYMENT-RESPONSE")).not.toBeNull()
  })

  it("does not emit a settlement header when nothing settled", async () => {
    const handler = makeHandler()
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(200)
    expect(extractSettlementTxHash(response)).toBeUndefined()
  })

  it("returns the response via waitUntil without awaiting the report", async () => {
    // A report that stays pending until we release it, so we can prove the
    // handler returns the response before the report settles.
    let releaseReport: () => void = () => {}
    const reportSettled = vi.fn()
    const pendingReport = new Promise<void>(resolve => {
      releaseReport = () => {
        reportSettled()
        resolve()
      }
    })
    vi.mocked(createEip3009UsageReporter).mockReturnValueOnce(
      vi.fn().mockReturnValue(pendingReport),
    )

    const registered: Promise<unknown>[] = []
    const waitUntil = vi.fn((p: Promise<unknown>) => {
      registered.push(p)
    })
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      usageReporting: {} as Eip3009UsageReporterConfig,
      waitUntil,
      handler: async input => ({ result: `Echo: ${input.query}` }),
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    })

    const response = await handler(request)

    expect(response.status).toBe(200)
    // The report was handed to waitUntil, not awaited: the response resolved
    // while the report is still pending.
    expect(waitUntil).toHaveBeenCalledOnce()
    expect(registered[0]).toBeInstanceOf(Promise)
    expect(reportSettled).not.toHaveBeenCalled()

    // Releasing it completes the backgrounded report.
    releaseReport()
    await registered[0]
    expect(reportSettled).toHaveBeenCalledOnce()
  })

  it("does not call settle() when a gate short-circuits with a response", async () => {
    const settle = vi.fn()
    const gate: GateMiddleware = {
      async check() {
        return Response.json({ error: "Blocked" }, { status: 402 })
      },
      settle,
    }
    const handler = makeHandler([gate])
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    )
    expect(response.status).toBe(402)
    expect(settle).not.toHaveBeenCalled()
  })

  it("does not call settle() when output schema validation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const settle = vi.fn()
    const gate: GateMiddleware = {
      async check() {
        return null
      },
      settle,
    }
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [gate],
      handler: async () =>
        ({ wrong: "shape" }) as unknown as { result: string },
    })
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    )
    expect(response.status).toBe(500)
    expect(settle).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("logs but does not bubble settle() errors — response stays 200", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const gate: GateMiddleware = {
      async check() {
        return null
      },
      async settle() {
        throw new Error("facilitator down")
      },
    }
    const handler = makeHandler([gate])
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "hello" }),
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result).toBe("Echo: hello")
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] gate.settle failed:",
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it("should return 500 when output schema validation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async () => {
        return { wrong: "shape" } as unknown as { result: string }
      },
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "test" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(500)
    const body = await response.json()
    expect(body).toEqual({ error: "Internal tool error" })
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] output schema validation failed:",
      expect.anything(),
    )
    errorSpy.mockRestore()
  })

  it("calls onInvocation after handler succeeds and output validates", async () => {
    const onInvocation = vi.fn()
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
      onInvocation,
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hello" }),
    })
    const response = await handler(request)
    expect(response.status).toBe(200)
    expect(onInvocation).toHaveBeenCalledOnce()
    const event: InvocationEvent = onInvocation.mock.calls[0]![0]
    expect(event.paid).toBe(false)
    expect(event.latencyMs).toBeGreaterThanOrEqual(0)
    expect(event.timestamp).toBeGreaterThan(0)
  })

  it("threads ctx.callerAuthorization from a gate into the invocation event", async () => {
    const callerAuthorization = {
      signature: "0xabcd" as `0x${string}`,
      from: "0x1111111111111111111111111111111111111111" as `0x${string}`,
      to: "0x2222222222222222222222222222222222222222" as `0x${string}`,
      value: "0" as const,
      validAfter: "0",
      validBefore: "9999999999",
      nonce: "0xbeef" as `0x${string}`,
      chainId: 8453,
    }
    const authGate: GateMiddleware = {
      check: async (_req, ctx) => {
        ctx.callerAddress = callerAuthorization.from
        ctx.callerAuthorization = callerAuthorization
        return null
      },
    }
    const onInvocation = vi.fn()
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
      gates: [authGate],
      onInvocation,
    })
    const request = new Request("https://test.example.com/api", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "hello" }),
    })
    await handler(request)
    const event: InvocationEvent = onInvocation.mock.calls[0]![0]
    expect(event.callerAuthorization).toEqual(callerAuthorization)
  })

  it("does not call onInvocation when gate blocks the request", async () => {
    const onInvocation = vi.fn()
    const gate: GateMiddleware = {
      async check() {
        return Response.json({ error: "Blocked" }, { status: 403 })
      },
    }
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [gate],
      handler: async input => ({ result: `Echo: ${input.query}` }),
      onInvocation,
    })
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    )
    expect(response.status).toBe(403)
    expect(onInvocation).not.toHaveBeenCalled()
  })

  it("does not call onInvocation when output schema validation fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const onInvocation = vi.fn()
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async () =>
        ({ wrong: "shape" }) as unknown as { result: string },
      onInvocation,
    })
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    )
    expect(response.status).toBe(500)
    expect(onInvocation).not.toHaveBeenCalled()
    errorSpy.mockRestore()
  })

  it("logs but does not bubble onInvocation errors — response stays 200", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const onInvocation = vi.fn().mockRejectedValue(new Error("reporter down"))
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
      onInvocation,
    })
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "hello" }),
      }),
    )
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.result).toBe("Echo: hello")
    expect(errorSpy).toHaveBeenCalledWith(
      "[tool-sdk] onInvocation failed:",
      expect.any(Error),
    )
    errorSpy.mockRestore()
  })

  it("calls onInvocation after settle() hooks run", async () => {
    const order: string[] = []
    const onInvocation = vi.fn(() => {
      order.push("onInvocation")
    })
    const gate: GateMiddleware = {
      async check() {
        return null
      },
      async settle() {
        order.push("settle")
      },
    }
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [gate],
      handler: async input => {
        order.push("handler")
        return { result: `Echo: ${input.query}` }
      },
      onInvocation,
    })
    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    )
    expect(response.status).toBe(200)
    expect(order).toEqual(["handler", "settle", "onInvocation"])
  })

  it("fires usageReporting on successful invocation", async () => {
    const { createEip3009UsageReporter } = await import(
      "../lib/usage/eip3009-reporter.js"
    )
    const mockReporter = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createEip3009UsageReporter).mockReturnValue(mockReporter)

    const usageReporting = {
      apiKey: "test-key",
      toolChainId: 8453,
      toolRegistryAddress: "0x1234567890abcdef1234567890abcdef12345678",
      toolOnchainId: 42,
    } as unknown as Eip3009UsageReporterConfig

    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
      usageReporting,
    })

    expect(createEip3009UsageReporter).toHaveBeenCalledWith(usageReporting)

    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "hello" }),
      }),
    )
    expect(response.status).toBe(200)

    // Awaited before the response resolves — no waitFor needed.
    expect(mockReporter).toHaveBeenCalledOnce()
    const event: InvocationEvent = mockReporter.mock.calls[0]![0]
    expect(event.paid).toBe(false)
    expect(event.latencyMs).toBeGreaterThanOrEqual(0)
  })

  it("awaits usageReporting before returning the response", async () => {
    // Regression guard: on serverless the function freezes once the response
    // flushes, so the report must complete *before* the handler resolves, not
    // fire-and-forget after.
    const { createEip3009UsageReporter } = await import(
      "../lib/usage/eip3009-reporter.js"
    )
    let releaseReport: () => void = () => {}
    const reportGate = new Promise<void>(resolve => {
      releaseReport = resolve
    })
    const mockReporter = vi.fn(() => reportGate)
    vi.mocked(createEip3009UsageReporter).mockReturnValue(mockReporter)

    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
      usageReporting: {} as unknown as Eip3009UsageReporterConfig,
    })

    let settled = false
    const pending = handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    ).then(res => {
      settled = true
      return res
    })

    // Let all of the handler's own awaits drain. The report promise is still
    // pending, so the handler must not have resolved.
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(mockReporter).toHaveBeenCalledOnce()
    expect(settled).toBe(false)

    releaseReport()
    const response = await pending
    expect(settled).toBe(true)
    expect(response.status).toBe(200)
  })

  it("logs usageReporting errors without affecting the response", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { createEip3009UsageReporter } = await import(
      "../lib/usage/eip3009-reporter.js"
    )
    vi.mocked(createEip3009UsageReporter).mockReturnValue(
      vi.fn().mockRejectedValue(new Error("network error")),
    )

    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
      usageReporting: {} as unknown as Eip3009UsageReporterConfig,
    })

    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "hello" }),
      }),
    )
    expect(response.status).toBe(200)
    await vi.waitFor(() =>
      expect(errorSpy).toHaveBeenCalledWith(
        "[tool-sdk] usageReporting failed:",
        expect.any(Error),
      ),
    )
    errorSpy.mockRestore()
  })

  it("does not fire usageReporting when gate blocks", async () => {
    const { createEip3009UsageReporter } = await import(
      "../lib/usage/eip3009-reporter.js"
    )
    const mockReporter = vi.fn().mockResolvedValue(undefined)
    vi.mocked(createEip3009UsageReporter).mockReturnValue(mockReporter)

    const gate: GateMiddleware = {
      async check() {
        return Response.json({ error: "Blocked" }, { status: 403 })
      },
    }
    const handler = createToolHandler({
      manifest: testManifest,
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [gate],
      handler: async input => ({ result: `Echo: ${input.query}` }),
      usageReporting: {} as unknown as Eip3009UsageReporterConfig,
    })

    const response = await handler(
      new Request("https://test.example.com/api", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: "test" }),
      }),
    )
    expect(response.status).toBe(403)
    expect(mockReporter).not.toHaveBeenCalled()
  })
})
