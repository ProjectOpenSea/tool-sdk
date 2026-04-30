import { describe, expect, it, vi } from "vitest"
import { z } from "zod/v4"
import { ToolHandlerError } from "../index.js"
import { createToolHandler } from "../lib/handler/index.js"
import type { ToolManifest } from "../lib/manifest/types.js"
import type { GateMiddleware } from "../types.js"

const testManifest = {
  type: "https://eips.ethereum.org/EIPS/eip-XXXX#tool-manifest-v1",
  name: "test-tool",
  description: "A test tool",
  endpoint: "https://test.example.com",
  inputs: {},
  outputs: {},
  creatorAddress: "0xabcdefabcdef1234567890abcdefabcdef123456",
} as ToolManifest

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
})
