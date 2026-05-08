import type { ToolHandlerConfig } from "../lib/handler/index.js"
import { createToolHandler } from "../lib/handler/index.js"
import type { ToolManifest } from "../lib/manifest/types.js"
import { createWellKnownHandler } from "../lib/middleware/well-known.js"
import type { GateMiddleware, ToolContext } from "../types.js"

/**
 * Returns a valid {@link ToolManifest} with sensible defaults.
 * Pass partial overrides to customise individual fields.
 */
export function createMockManifest(
  overrides?: Partial<ToolManifest>,
): ToolManifest {
  return {
    type: "https://ercs.ethereum.org/ERCS/erc-8257#tool-manifest-v1",
    name: "test-tool",
    description: "A test tool for unit tests",
    endpoint: "https://test.example.com",
    inputs: { type: "object" },
    outputs: { type: "object" },
    creatorAddress: "0x0000000000000000000000000000000000000001",
    ...overrides,
  }
}

/**
 * Returns a valid {@link ToolContext} with sensible defaults.
 * Pass partial overrides to customise individual fields.
 */
export function createMockToolContext(
  overrides?: Partial<ToolContext>,
): ToolContext {
  return {
    gates: {},
    manifest: createMockManifest(),
    request: new Request("https://test.example.com/api", { method: "POST" }),
    ...overrides,
  }
}

/** A recorded fetch call from {@link mockFetch}. */
export interface MockFetchCall {
  url: string
  init?: RequestInit
}

/** A single handler entry for {@link mockFetch}. */
export interface MockFetchHandler {
  /** URL pattern to match — plain string uses `includes`, RegExp uses `.test()`. */
  pattern: string | RegExp
  /**
   * Canned response. A `Response` is returned as-is (cloned); a plain object
   * is JSON-serialised; a callback receives the request info and returns
   * either form.
   */
  response:
    | Response
    | object
    | ((req: { url: string; init?: RequestInit }) => Response | object)
  /** HTTP status code (defaults to 200). Ignored when `response` is a `Response`. */
  status?: number
}

/** Return value of {@link mockFetch}. */
export interface MockFetchResult {
  /** Restores the original `globalThis.fetch`. */
  cleanup: () => void
  /** Every call that hit the mock, in order. */
  calls: MockFetchCall[]
}

/**
 * Replaces `globalThis.fetch` with a lightweight mock that matches requests
 * against the provided handlers.
 *
 * Returns `{ cleanup, calls }` — call `cleanup()` to restore the original
 * `fetch`, and inspect `calls` to assert on what was fetched.
 *
 * Handlers are evaluated in order; the first match wins. Unmatched requests
 * receive a `501 Not Implemented` response.
 */
export function mockFetch(handlers: MockFetchHandler[]): MockFetchResult {
  const original = globalThis.fetch
  const calls: MockFetchCall[] = []

  globalThis.fetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url

    calls.push({ url, init })

    for (const handler of handlers) {
      const matched =
        typeof handler.pattern === "string"
          ? url.includes(handler.pattern)
          : handler.pattern.test(url)

      if (matched) {
        const raw =
          typeof handler.response === "function"
            ? handler.response({ url, init })
            : handler.response
        if (raw instanceof Response) {
          return raw.clone()
        }
        return new Response(JSON.stringify(raw), {
          status: handler.status ?? 200,
          headers: { "Content-Type": "application/json" },
        })
      }
    }

    return new Response(
      JSON.stringify({ error: "No mock handler matched", url }),
      { status: 501, headers: { "Content-Type": "application/json" } },
    )
  }

  return {
    cleanup: () => {
      globalThis.fetch = original
    },
    calls,
  }
}

/** Gate names that can be bypassed via {@link TestHandlerConfig.bypassGates}. */
export interface BypassGates {
  nft?: "granted"
  predicate?: "granted"
  x402?: "paid"
}

/** Options for {@link createTestHandler}. */
export interface TestHandlerConfig<TIn, TOut>
  extends Omit<ToolHandlerConfig<TIn, TOut>, "manifest"> {
  /** Optional manifest overrides. A full mock manifest is generated if omitted. */
  manifest?: Partial<ToolManifest>
  /**
   * Synthesise a pre-authorised {@link ToolContext} so real gates are skipped.
   * The original `gates` array is replaced with a single pass-through gate
   * that populates `ctx.gates` with the specified values.
   */
  bypassGates?: BypassGates
}

/** Return value of {@link createTestHandler}. */
export interface TestHandler<TIn> {
  /** The raw request handler produced by `createToolHandler`. */
  handler: (request: Request) => Promise<Response>
  /**
   * Convenience helper — builds a POST Request with the given input as JSON
   * body and passes it to the handler.
   */
  invoke: (input: TIn, opts?: { headers?: HeadersInit }) => Promise<Response>
}

function buildBypassGate(bypass: BypassGates): GateMiddleware {
  return {
    async check(_request, ctx) {
      if (bypass.nft) ctx.gates = { ...ctx.gates, nft: { granted: true } }
      if (bypass.predicate)
        ctx.gates = { ...ctx.gates, predicate: { granted: true } }
      if (bypass.x402) ctx.gates = { ...ctx.gates, x402: { paid: true } }
      return null
    },
  }
}

/**
 * Wraps {@link createToolHandler} with a mock manifest and pre-configured
 * schemas. Returns both the handler and a convenience `invoke(input)` that
 * builds the POST Request for you.
 */
export function createTestHandler<TIn, TOut>(
  config: TestHandlerConfig<TIn, TOut>,
): TestHandler<TIn> {
  const manifest = createMockManifest(config.manifest)
  const gates = config.bypassGates
    ? [buildBypassGate(config.bypassGates)]
    : config.gates
  const handler = createToolHandler({
    ...config,
    manifest,
    gates,
  })

  const invoke = async (
    input: TIn,
    opts?: { headers?: HeadersInit },
  ): Promise<Response> => {
    const headers = new Headers({ "Content-Type": "application/json" })
    if (opts?.headers) {
      const extra = new Headers(opts.headers)
      for (const [key, value] of extra.entries()) {
        headers.set(key, value)
      }
    }
    const request = new Request(manifest.endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify(input),
    })
    return handler(request)
  }

  return { handler, invoke }
}

/** Options for {@link assertManifestServed}. */
export interface AssertManifestServedOptions {
  /** The manifest slug (derived from manifest name if omitted). */
  slug?: string
  /** Subset of manifest fields to assert on the response body. */
  expect?: Partial<ToolManifest>
}

/**
 * Asserts that a well-known manifest endpoint serves the expected manifest.
 * Returns the parsed manifest body for further assertions.
 */
export async function assertManifestServed(
  manifest: ToolManifest,
  opts?: AssertManifestServedOptions,
): Promise<Record<string, unknown>> {
  const slug =
    opts?.slug ??
    manifest.name
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "")
  const wellKnownHandler = createWellKnownHandler(manifest)
  const url = `${manifest.endpoint}/.well-known/ai-tool/${slug}.json`
  const request = new Request(url)
  const response = wellKnownHandler(request)
  if (response.status !== 200) {
    throw new Error(
      `Expected 200 from well-known endpoint, got ${response.status}`,
    )
  }
  const body = (await response.json()) as Record<string, unknown>
  if (opts?.expect) {
    for (const [key, value] of Object.entries(opts.expect)) {
      if (JSON.stringify(body[key]) !== JSON.stringify(value)) {
        throw new Error(
          `Manifest field "${key}": expected ${JSON.stringify(value)}, got ${JSON.stringify(body[key])}`,
        )
      }
    }
  }
  return body
}
