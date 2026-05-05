import { afterEach, describe, expect, it, vi } from "vitest"
import { z } from "zod/v4"
import {
  assertManifestServed,
  createMockManifest,
  createMockToolContext,
  createTestHandler,
  mockFetch,
} from "../testing/index.js"

describe("createMockManifest", () => {
  it("returns a valid manifest with defaults", () => {
    const manifest = createMockManifest()
    expect(manifest.name).toBe("test-tool")
    expect(manifest.endpoint).toBe("https://test.example.com")
    expect(manifest.creatorAddress).toBe(
      "0x0000000000000000000000000000000000000001",
    )
    expect(manifest.inputs).toEqual({ type: "object" })
    expect(manifest.outputs).toEqual({ type: "object" })
  })

  it("accepts partial overrides", () => {
    const manifest = createMockManifest({
      name: "custom-tool",
      description: "Custom description",
    })
    expect(manifest.name).toBe("custom-tool")
    expect(manifest.description).toBe("Custom description")
    expect(manifest.endpoint).toBe("https://test.example.com")
  })
})

describe("createMockToolContext", () => {
  it("returns a valid context with defaults", () => {
    const ctx = createMockToolContext()
    expect(ctx.gates).toEqual({})
    expect(ctx.manifest.name).toBe("test-tool")
    expect(ctx.request.method).toBe("POST")
  })

  it("accepts partial overrides", () => {
    const ctx = createMockToolContext({
      callerAddress: "0x1234567890abcdef1234567890abcdef12345678",
      gates: { nft: { granted: true } },
    })
    expect(ctx.callerAddress).toBe("0x1234567890abcdef1234567890abcdef12345678")
    expect(ctx.gates.nft?.granted).toBe(true)
    expect(ctx.manifest.name).toBe("test-tool")
  })

  it("uses provided manifest override", () => {
    const manifest = createMockManifest({ name: "ctx-tool" })
    const ctx = createMockToolContext({ manifest })
    expect(ctx.manifest.name).toBe("ctx-tool")
  })
})

describe("mockFetch", () => {
  let result: ReturnType<typeof mockFetch> | undefined

  afterEach(() => {
    result?.cleanup()
    result = undefined
  })

  it("matches on string pattern and returns JSON object", async () => {
    result = mockFetch([{ pattern: "/api/data", response: { value: 42 } }])
    const res = await fetch("https://example.com/api/data")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ value: 42 })
  })

  it("matches on RegExp pattern", async () => {
    result = mockFetch([
      { pattern: /\/users\/\d+/, response: { id: 1, name: "Alice" } },
    ])
    const res = await fetch("https://example.com/users/123")
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 1, name: "Alice" })
  })

  it("respects custom status codes", async () => {
    result = mockFetch([
      { pattern: "/fail", response: { error: "not found" }, status: 404 },
    ])
    const res = await fetch("https://example.com/fail")
    expect(res.status).toBe(404)
  })

  it("returns a Response as-is when provided", async () => {
    const custom = new Response("raw body", {
      status: 201,
      headers: { "X-Custom": "yes" },
    })
    result = mockFetch([{ pattern: "/raw", response: custom }])
    const res = await fetch("https://example.com/raw")
    expect(res.status).toBe(201)
    expect(await res.text()).toBe("raw body")
  })

  it("returns 501 for unmatched requests", async () => {
    result = mockFetch([])
    const res = await fetch("https://example.com/unknown")
    expect(res.status).toBe(501)
    const body = await res.json()
    expect(body.error).toBe("No mock handler matched")
  })

  it("uses first matching handler when multiple match", async () => {
    result = mockFetch([
      { pattern: "/api", response: { first: true } },
      { pattern: "/api", response: { second: true } },
    ])
    const res = await fetch("https://example.com/api")
    expect(await res.json()).toEqual({ first: true })
  })

  it("restores original fetch on cleanup", () => {
    const originalFetch = globalThis.fetch
    result = mockFetch([{ pattern: "/test", response: {} }])
    expect(globalThis.fetch).not.toBe(originalFetch)
    result.cleanup()
    expect(globalThis.fetch).toBe(originalFetch)
    result = undefined
  })

  it("tracks calls with url and init", async () => {
    result = mockFetch([{ pattern: "/api", response: { ok: true } }])
    await fetch("https://example.com/api/v1", { method: "POST" })
    await fetch("https://example.com/api/v2")
    await fetch("https://example.com/other")

    expect(result.calls).toHaveLength(3)
    expect(result.calls[0].url).toContain("/api/v1")
    expect(result.calls[0].init?.method).toBe("POST")
    expect(result.calls[1].url).toContain("/api/v2")
    expect(result.calls[2].url).toContain("/other")
  })

  it("supports callback response form", async () => {
    result = mockFetch([
      {
        pattern: "/echo",
        response: req => ({ method: req.init?.method ?? "GET", url: req.url }),
      },
    ])
    const res = await fetch("https://example.com/echo", { method: "PUT" })
    expect(await res.json()).toEqual({
      method: "PUT",
      url: "https://example.com/echo",
    })
  })

  it("callback can return a Response", async () => {
    result = mockFetch([
      {
        pattern: "/dynamic",
        response: req =>
          req.init?.method === "DELETE"
            ? new Response(null, { status: 204 })
            : { ok: true },
      },
    ])
    const del = await fetch("https://example.com/dynamic", { method: "DELETE" })
    expect(del.status).toBe(204)

    const get = await fetch("https://example.com/dynamic")
    expect(get.status).toBe(200)
    expect(await get.json()).toEqual({ ok: true })
  })

  it("handles duplicate fetches to the same URL with Response.clone()", async () => {
    const custom = new Response(JSON.stringify({ data: "hello" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
    result = mockFetch([{ pattern: "/clone", response: custom }])

    const res1 = await fetch("https://example.com/clone")
    const res2 = await fetch("https://example.com/clone")

    expect(await res1.json()).toEqual({ data: "hello" })
    expect(await res2.json()).toEqual({ data: "hello" })
    expect(result.calls).toHaveLength(2)
  })
})

describe("createTestHandler", () => {
  const InputSchema = z.object({ query: z.string() })
  const OutputSchema = z.object({ result: z.string() })

  it("invoke sends a POST with JSON body and returns response", async () => {
    const { invoke } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: `Echo: ${input.query}` }),
    })
    const res = await invoke({ query: "hello" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "Echo: hello" })
  })

  it("handler rejects non-POST requests", async () => {
    const { handler } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: input.query }),
    })
    const res = await handler(
      new Request("https://test.example.com", { method: "GET" }),
    )
    expect(res.status).toBe(405)
  })

  it("accepts manifest overrides", async () => {
    const { invoke } = createTestHandler({
      manifest: { name: "custom-test-tool" },
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async (_input, ctx) => ({ result: ctx.manifest.name }),
    })
    const res = await invoke({ query: "test" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "custom-test-tool" })
  })

  it("validates input schema", async () => {
    const { invoke } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async input => ({ result: input.query }),
    })
    const res = await invoke({ query: 123 } as unknown as { query: string })
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe("Invalid input")
  })

  it("returns 500 when handler throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const { invoke } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async () => {
        throw new Error("boom")
      },
    })
    const res = await invoke({ query: "test" })
    expect(res.status).toBe(500)
    const body = await res.json()
    expect(body.error).toBe("Internal tool error")
    errorSpy.mockRestore()
  })

  it("invoke passes custom headers", async () => {
    const { invoke } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      handler: async (_input, ctx) => ({
        result: ctx.request.headers.get("X-Custom") ?? "missing",
      }),
    })
    const res = await invoke(
      { query: "test" },
      { headers: { "X-Custom": "hello" } },
    )
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "hello" })
  })

  it("bypassGates populates ctx.gates without real gate logic", async () => {
    const CtxOutputSchema = z.object({
      nft: z.boolean(),
      predicate: z.boolean(),
      x402: z.boolean(),
    })
    const { invoke } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: CtxOutputSchema,
      handler: async (_input, ctx) => ({
        nft: ctx.gates.nft?.granted ?? false,
        predicate: ctx.gates.predicate?.granted ?? false,
        x402: ctx.gates.x402?.paid ?? false,
      }),
      bypassGates: { nft: "granted", predicate: "granted", x402: "paid" },
    })
    const res = await invoke({ query: "test" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      nft: true,
      predicate: true,
      x402: true,
    })
  })

  it("bypassGates replaces real gates array", async () => {
    const blockingGate = {
      async check() {
        return Response.json({ error: "Blocked" }, { status: 403 })
      },
    }
    const { invoke } = createTestHandler({
      inputSchema: InputSchema,
      outputSchema: OutputSchema,
      gates: [blockingGate],
      handler: async input => ({ result: input.query }),
      bypassGates: { x402: "paid" },
    })
    const res = await invoke({ query: "should pass" })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ result: "should pass" })
  })
})

describe("assertManifestServed", () => {
  it("returns manifest body when well-known endpoint serves correctly", async () => {
    const manifest = createMockManifest({ name: "my-tool" })
    const body = await assertManifestServed(manifest)
    expect(body.name).toBe("my-tool")
    expect(body.endpoint).toBe("https://test.example.com")
  })

  it("asserts on expected fields", async () => {
    const manifest = createMockManifest({ name: "check-tool" })
    await expect(
      assertManifestServed(manifest, { expect: { name: "wrong-name" } }),
    ).rejects.toThrow('Manifest field "name"')
  })

  it("accepts custom slug override", async () => {
    const manifest = createMockManifest({ name: "My Tool" })
    const body = await assertManifestServed(manifest, { slug: "my-tool" })
    expect(body.name).toBe("My Tool")
  })
})
