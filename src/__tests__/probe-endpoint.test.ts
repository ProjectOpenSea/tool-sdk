import { afterEach, describe, expect, it, vi } from "vitest"
import {
  isPrivateHostname,
  probeEndpoint,
} from "../cli/commands/probe-endpoint.js"

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("probeEndpoint", () => {
  it("returns pass for 401", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 401 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("pass")
    expect(result.status).toBe(401)
  })

  it("returns pass for 402", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 402 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("pass")
    expect(result.status).toBe(402)
  })

  it("returns pass for 403", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 403 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("pass")
    expect(result.status).toBe(403)
  })

  it("returns warn for 200", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 200 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("warn")
    expect(result.status).toBe(200)
    expect(result.message).toContain("gate may not be enforcing")
  })

  it("returns fail for 405", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 405 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("fail")
    expect(result.status).toBe(405)
    expect(result.message).toContain("405 Method Not Allowed")
  })

  it("returns fail for 404", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("fail")
    expect(result.status).toBe(404)
    expect(result.message).toContain("handler not found")
  })

  it("returns fail for 500", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 500 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("fail")
    expect(result.status).toBe(500)
    expect(result.message).toContain("server error")
  })

  it("returns fail for 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 502 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("fail")
    expect(result.status).toBe(502)
  })

  it("returns warn for unexpected status like 301", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 301 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("warn")
    expect(result.status).toBe(301)
    expect(result.message).toContain("unexpected status 301")
  })

  it("returns fail on network error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED")
      }),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("fail")
    expect(result.status).toBe(0)
    expect(result.message).toContain("ECONNREFUSED")
  })

  it("returns fail on timeout", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new DOMException("Signal timed out.", "TimeoutError")
      }),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("fail")
    expect(result.status).toBe(0)
    expect(result.message).toContain("timed out")
  })

  it("sends POST with empty JSON body", async () => {
    let capturedInit: RequestInit | undefined
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        capturedInit = init
        return new Response(null, { status: 401 })
      }),
    )
    await probeEndpoint("https://example.com/api")
    expect(capturedInit?.method).toBe("POST")
    expect(capturedInit?.body).toBe("{}")
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get("Content-Type")).toBe("application/json")
  })

  it("warns on private/internal hostname without making a request", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await probeEndpoint("https://localhost/api")
    expect(result.level).toBe("warn")
    expect(result.message).toContain("private/internal")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("warns on 127.x.x.x addresses", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await probeEndpoint("https://127.0.0.1/api")
    expect(result.level).toBe("warn")
    expect(result.message).toContain("private/internal")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("warns on 10.x.x.x addresses", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await probeEndpoint("https://10.0.1.5/api")
    expect(result.level).toBe("warn")
    expect(result.message).toContain("private/internal")
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it("warns on 192.168.x.x addresses", async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal("fetch", fetchSpy)

    const result = await probeEndpoint("https://192.168.1.1/api")
    expect(result.level).toBe("warn")
    expect(result.message).toContain("private/internal")
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe("isPrivateHostname", () => {
  it("detects localhost", () => {
    expect(isPrivateHostname("localhost")).toBe(true)
  })

  it("detects 127.0.0.1", () => {
    expect(isPrivateHostname("127.0.0.1")).toBe(true)
  })

  it("detects 10.x.x.x", () => {
    expect(isPrivateHostname("10.0.0.1")).toBe(true)
    expect(isPrivateHostname("10.255.255.255")).toBe(true)
  })

  it("detects 172.16-31.x.x", () => {
    expect(isPrivateHostname("172.16.0.1")).toBe(true)
    expect(isPrivateHostname("172.31.255.255")).toBe(true)
    expect(isPrivateHostname("172.15.0.1")).toBe(false)
    expect(isPrivateHostname("172.32.0.1")).toBe(false)
  })

  it("detects 192.168.x.x", () => {
    expect(isPrivateHostname("192.168.0.1")).toBe(true)
    expect(isPrivateHostname("192.168.255.255")).toBe(true)
  })

  it("detects IPv6 loopback", () => {
    expect(isPrivateHostname("::1")).toBe(true)
    expect(isPrivateHostname("[::1]")).toBe(true)
  })

  it("detects fe80 link-local", () => {
    expect(isPrivateHostname("fe80::1")).toBe(true)
  })

  it("allows public hostnames", () => {
    expect(isPrivateHostname("example.com")).toBe(false)
    expect(isPrivateHostname("8.8.8.8")).toBe(false)
    expect(isPrivateHostname("api.opensea.io")).toBe(false)
  })
})
