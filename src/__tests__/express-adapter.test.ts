import type { Express, RequestHandler } from "express"
import { describe, expect, it } from "vitest"
import {
  type ExpressRequest,
  type ExpressResponse,
  toExpressHandler,
} from "../lib/adapters/express.js"

const echo = async (request: Request) =>
  new Response(
    JSON.stringify({
      method: request.method,
      url: request.url,
      header: request.headers.get("x-forwarded"),
      body: request.body ? await request.text() : null,
    }),
    { status: 201, headers: { "x-tool": "echo" } },
  )

// Type-checked by `tsc -p tsconfig.check.json`: mirrors the express template's
// server.ts against the real Express 5 types it installs.
function registerTemplateRoutes(app: Express): RequestHandler {
  app.post("/api", toExpressHandler(echo))
  app.get("/.well-known/ai-tool/:slug", toExpressHandler(echo))
  return toExpressHandler(echo)
}

function fakeResponse() {
  const recorded = {
    statuses: [] as number[],
    headers: {} as Record<string, string>,
    sent: undefined as string | undefined,
    json: undefined as unknown,
  }
  let finish: () => void = () => {}
  const finished = new Promise<void>(resolve => {
    finish = resolve
  })
  const res: ExpressResponse = {
    status(code) {
      recorded.statuses.push(code)
      return res
    },
    set(name, value) {
      recorded.headers[name] = value
      return res
    },
    json(body) {
      recorded.json = body
      finish()
    },
    send(body) {
      recorded.sent = String(body)
      finish()
    },
    end() {
      finish()
    },
  }
  return { res, recorded, finished }
}

function fakeRequest(overrides: Partial<ExpressRequest>): ExpressRequest {
  return {
    method: "GET",
    url: "/api",
    headers: { host: "tool.example.com" },
    hostname: "fallback.example.com",
    protocol: "https",
    ...overrides,
  }
}

describe("toExpressHandler", () => {
  it("returns a handler Express 5 accepts as a RequestHandler", () => {
    expect(typeof registerTemplateRoutes).toBe("function")
  })

  it("translates a POST into a web Request and writes the web Response back", async () => {
    const { res, recorded, finished } = fakeResponse()
    toExpressHandler(echo)(
      fakeRequest({
        method: "POST",
        headers: { host: "tool.example.com", "x-forwarded": ["a", "b"] },
        body: { query: "hi" },
      }),
      res,
    )
    await finished

    expect(recorded.statuses).toEqual([201])
    expect(recorded.headers["x-tool"]).toBe("echo")
    expect(JSON.parse(recorded.sent ?? "")).toEqual({
      method: "POST",
      url: "https://tool.example.com/api",
      header: "a, b",
      body: JSON.stringify({ query: "hi" }),
    })
  })

  it("sends no body for GET and falls back to hostname without a Host header", async () => {
    const { res, recorded, finished } = fakeResponse()
    toExpressHandler(echo)(fakeRequest({ headers: {} }), res)
    await finished

    expect(JSON.parse(recorded.sent ?? "")).toMatchObject({
      method: "GET",
      url: "https://fallback.example.com/api",
      body: null,
    })
  })

  it("responds 500 when the handler rejects", async () => {
    const { res, recorded, finished } = fakeResponse()
    toExpressHandler(async () => {
      throw new Error("boom")
    })(fakeRequest({}), res)
    await finished

    expect(recorded.statuses).toEqual([500])
    expect(recorded.json).toEqual({ error: "Internal tool error" })
  })
})
