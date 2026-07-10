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

  it("returns pass for 400 (request rejected)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 400 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("pass")
    expect(result.status).toBe(400)
    expect(result.message).toContain("request rejected by server")
  })

  it("returns pass for 422 (other client error)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 422 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("pass")
    expect(result.status).toBe(422)
    expect(result.message).toContain("request rejected by server")
  })

  it("returns pass for 429 (rate limited)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 429 })),
    )
    const result = await probeEndpoint("https://example.com/api")
    expect(result.level).toBe("pass")
    expect(result.status).toBe(429)
    expect(result.message).toContain("request rejected by server")
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

  it("detects the unspecified address 0.0.0.0", () => {
    expect(isPrivateHostname("0.0.0.0")).toBe(true)
  })

  it("detects CGNAT 100.64.0.0/10", () => {
    expect(isPrivateHostname("100.64.0.1")).toBe(true)
    expect(isPrivateHostname("100.127.255.255")).toBe(true)
    // Boundaries: 100.63 and 100.128 are public
    expect(isPrivateHostname("100.63.255.255")).toBe(false)
    expect(isPrivateHostname("100.128.0.1")).toBe(false)
  })

  it("detects IPv6 unique-local fc00::/7", () => {
    expect(isPrivateHostname("fc00::1")).toBe(true)
    expect(isPrivateHostname("fd12:3456::1")).toBe(true)
    expect(isPrivateHostname("[fd00::1]")).toBe(true)
  })

  it("detects decimal-encoded IPv4 literals", () => {
    expect(isPrivateHostname("2130706433")).toBe(true) // 127.0.0.1
    expect(isPrivateHostname("3232235521")).toBe(true) // 192.168.0.1
    expect(isPrivateHostname("2852039166")).toBe(true) // 169.254.169.254
    expect(isPrivateHostname("167772161")).toBe(true) // 10.0.0.1
    // 8.8.8.8 in decimal is public
    expect(isPrivateHostname("134744072")).toBe(false)
  })

  it("detects octal-encoded IPv4 literals", () => {
    expect(isPrivateHostname("0177.0.0.1")).toBe(true) // 127.0.0.1
    expect(isPrivateHostname("012.0.0.1")).toBe(true) // 10.0.0.1
    expect(isPrivateHostname("0251.0376.0251.0376")).toBe(true) // 169.254.169.254
    expect(isPrivateHostname("017700000001")).toBe(true) // 127.0.0.1 as one octal number
    // 8.8.8.8 in octal is public
    expect(isPrivateHostname("010.010.010.010")).toBe(false)
  })

  it("detects hex-encoded IPv4 literals", () => {
    expect(isPrivateHostname("0x7f.0.0.1")).toBe(true) // 127.0.0.1
    expect(isPrivateHostname("0x7f000001")).toBe(true) // 127.0.0.1 as one hex number
    expect(isPrivateHostname("0xa9fea9a9")).toBe(true) // 169.254.169.254
    expect(isPrivateHostname("0xC0.0xA8.0x00.0x01")).toBe(true) // 192.168.0.1
    // 8.8.8.8 in hex is public
    expect(isPrivateHostname("0x08080808")).toBe(false)
  })

  it("detects partial dotted IPv4 forms", () => {
    expect(isPrivateHostname("127.1")).toBe(true) // 127.0.0.1
    expect(isPrivateHostname("10.1")).toBe(true) // 10.0.0.1
    expect(isPrivateHostname("169.254.43434")).toBe(true) // 169.254.169.170
    expect(isPrivateHostname("8.8.2056")).toBe(false) // 8.8.8.8
  })

  it("detects IPv4-mapped IPv6 addresses", () => {
    expect(isPrivateHostname("::ffff:169.254.169.254")).toBe(true)
    expect(isPrivateHostname("[::ffff:169.254.169.254]")).toBe(true)
    expect(isPrivateHostname("::ffff:a9fe:a9a9")).toBe(true) // hex form of 169.254.169.254
    expect(isPrivateHostname("::ffff:127.0.0.1")).toBe(true)
    expect(isPrivateHostname("::ffff:7f00:1")).toBe(true) // hex form of 127.0.0.1
    expect(isPrivateHostname("::ffff:10.0.0.1")).toBe(true)
    // Mapped public IPs stay public
    expect(isPrivateHostname("::ffff:8.8.8.8")).toBe(false)
    expect(isPrivateHostname("::ffff:808:808")).toBe(false)
  })

  it("detects IPv4-compatible IPv6 addresses", () => {
    expect(isPrivateHostname("::127.0.0.1")).toBe(true)
    expect(isPrivateHostname("::a9fe:a9a9")).toBe(true) // ::169.254.169.254
    expect(isPrivateHostname("::8.8.8.8")).toBe(false)
  })

  it("detects the IPv6 unspecified address", () => {
    expect(isPrivateHostname("::")).toBe(true)
    expect(isPrivateHostname("[::]")).toBe(true)
  })

  it("detects fully-expanded IPv6 private literals", () => {
    expect(isPrivateHostname("0:0:0:0:0:0:0:1")).toBe(true) // ::1 expanded
    expect(isPrivateHostname("fe80:0:0:0:0:0:0:1")).toBe(true)
    expect(isPrivateHostname("fe80::1%eth0")).toBe(true) // zone id
  })

  it("allows public hostnames", () => {
    expect(isPrivateHostname("example.com")).toBe(false)
    expect(isPrivateHostname("8.8.8.8")).toBe(false)
    expect(isPrivateHostname("api.opensea.io")).toBe(false)
    // Public IPv6 (Cloudflare) must not be mistaken for unique-local
    expect(isPrivateHostname("2606:4700::1")).toBe(false)
    // fe00:: is reserved-but-not-link-local prefix; must not match fc/fd/fe80
    expect(isPrivateHostname("fe00::1")).toBe(false)
  })
})
