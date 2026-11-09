import type { IncomingMessage, ServerResponse } from "node:http"
import { describe, expect, it } from "vitest"
import {
  toVercelHandler,
  type VercelRequest,
  type VercelResponse,
} from "../lib/adapters/vercel.js"

// @vercel/node declares its request and response as Node's http types plus
// helpers. Node's `method` is optional and neither type has an index
// signature, which is what a function typed with @vercel/node passes in.
type NodeVercelRequest = IncomingMessage & {
  query: Partial<Record<string, string | string[]>>
  cookies: Partial<Record<string, string>>
  body: unknown
}
type NodeVercelResponse = ServerResponse & {
  send: (body: unknown) => NodeVercelResponse
  json: (body: unknown) => NodeVercelResponse
  status: (statusCode: number) => NodeVercelResponse
}

const echo = async (request: Request) =>
  new Response(
    JSON.stringify({
      method: request.method,
      url: request.url,
      body: request.body ? await request.text() : null,
    }),
    { status: 202, headers: { "x-tool": "echo" } },
  )

// Type-checked by `tsc -p tsconfig.check.json`: a Vercel function typed with
// @vercel/node's request and response must accept toVercelHandler's handler.
function vercelNodeFunction(req: NodeVercelRequest, res: NodeVercelResponse) {
  return toVercelHandler(echo)(req, res)
}

function fakeResponse() {
  const recorded = {
    statuses: [] as number[],
    headers: {} as Record<string, string>,
    sent: undefined as string | undefined,
  }
  const res: VercelResponse = {
    status(code) {
      recorded.statuses.push(code)
      return res
    },
    setHeader(name, value) {
      recorded.headers[name] = value
      return res
    },
    json() {},
    send(body) {
      recorded.sent = String(body)
    },
    end() {},
  }
  return { res, recorded }
}

describe("toVercelHandler", () => {
  it("accepts a request and response typed with @vercel/node", () => {
    expect(typeof vercelNodeFunction).toBe("function")
  })

  it("translates a POST using x-forwarded-proto and the Host header", async () => {
    const { res, recorded } = fakeResponse()
    const req: VercelRequest = {
      method: "POST",
      url: "/api",
      headers: { host: "tool.example.com", "x-forwarded-proto": "http" },
      body: { query: "hi" },
    }
    await toVercelHandler(echo)(req, res)

    expect(recorded.statuses).toEqual([202])
    expect(recorded.headers["x-tool"]).toBe("echo")
    expect(JSON.parse(recorded.sent ?? "")).toEqual({
      method: "POST",
      url: "http://tool.example.com/api",
      body: JSON.stringify({ query: "hi" }),
    })
  })

  it("treats a request without a method as GET and sends no body", async () => {
    const { res, recorded } = fakeResponse()
    await toVercelHandler(echo)(
      { headers: { host: "tool.example.com" }, body: { ignored: true } },
      res,
    )

    expect(JSON.parse(recorded.sent ?? "")).toEqual({
      method: "GET",
      url: "https://tool.example.com/",
      body: null,
    })
  })
})
