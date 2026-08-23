import { lookup } from "node:dns/promises"
import pc from "picocolors"

export interface ProbeResult {
  status: number
  level: "pass" | "warn" | "fail"
  message: string
}

// Static private/internal-host guard. Hostnames that parse as IP literals
// (including alternate encodings: decimal `2130706433`, octal `0177.0.0.1`,
// hex `0x7f.0.0.1`, partial dotted forms like `127.1`, and IPv4-mapped IPv6
// like `::ffff:169.254.169.254` / `::ffff:a9fe:a9a9`) are numerically
// range-checked; other names fall back to a literal-name regex. This guard
// alone does not resolve DNS, so a hostname that itself looks public but
// resolves to a private/internal address (or is rebound to one) would slip
// past it -- see `classifyResolvedHostname` below, which every caller applies
// in addition to this check before anything is fetched. A fully
// connect-time-pinned request (resolve once, dial the validated IP directly)
// would close the remaining DNS-rebinding TOCTOU window and is tracked as
// further hardening.
//
// Rejected ranges:
//   - 0.0.0.0/8               unspecified / "this network"
//   - 127.0.0.0/8             loopback
//   - 10.0.0.0/8              private
//   - 100.64.0.0/10           CGNAT (second octet 64-127)
//   - 172.16.0.0/12           private (second octet 16-31)
//   - 192.168.0.0/16          private
//   - 169.254.0.0/16          link-local (contains the 169.254.169.254 cloud-metadata endpoint)
//   - ::                      IPv6 unspecified
//   - ::1                     IPv6 loopback
//   - ::ffff:0:0/96, ::/96    IPv4-mapped / IPv4-compatible (checked as IPv4)
//   - fc00::/7                IPv6 unique-local (first hextet fc00-fdff)
//   - fe80::/10               IPv6 link-local
const PRIVATE_HOSTNAME_RE =
  /^(localhost|0\.0\.0\.0|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|\[?::1\]?|\[?f[cd][0-9a-f]{2}:|\[?fe80:)/i

// inet_aton-style IPv4 part: hex (0x..), octal (leading 0), or decimal.
const IPV4_PART_RE = /^(0x[0-9a-f]+|0[0-7]*|[1-9]\d*)$/i

// Parses an IPv4 literal in any inet_aton encoding (dotted decimal/octal/hex
// with 1-4 parts, e.g. `2130706433`, `0177.0.0.1`, `0x7f.0.0.1`, `127.1`)
// into its 32-bit value. Returns null if not an IPv4 literal.
function parseIpv4(hostname: string): number | null {
  const parts = hostname.split(".")
  if (parts.length === 0 || parts.length > 4) return null
  const nums: number[] = []
  for (const part of parts) {
    if (!IPV4_PART_RE.test(part)) return null
    const value = /^0x/i.test(part)
      ? Number.parseInt(part.slice(2), 16)
      : part.length > 1 && part.startsWith("0")
        ? Number.parseInt(part, 8)
        : Number.parseInt(part, 10)
    if (!Number.isSafeInteger(value)) return null
    nums.push(value)
  }
  const last = nums[nums.length - 1]
  const prefix = nums.slice(0, -1)
  if (prefix.some(n => n > 255)) return null
  if (last >= 256 ** (4 - prefix.length)) return null
  let value = 0
  for (const n of prefix) value = value * 256 + n
  return value * 256 ** (4 - prefix.length) + last
}

function isPrivateIpv4(value: number): boolean {
  const a = Math.floor(value / 0x1000000) % 256
  const b = Math.floor(value / 0x10000) % 256
  return (
    a === 0 || // 0.0.0.0/8 unspecified / "this network"
    a === 127 || // loopback
    a === 10 || // private
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64.0.0/10
    (a === 172 && b >= 16 && b <= 31) || // private 172.16.0.0/12
    (a === 192 && b === 168) || // private
    (a === 169 && b === 254) // link-local (cloud metadata)
  )
}

// Parses an IPv6 literal (optionally bracketed, with optional zone id and an
// optional embedded dotted-quad IPv4 tail) into its 8 hextets. Returns null
// if not a valid IPv6 literal.
function parseIpv6(hostname: string): number[] | null {
  let h = hostname.toLowerCase()
  if (h.startsWith("[") && h.endsWith("]")) h = h.slice(1, -1)
  const pct = h.indexOf("%")
  if (pct !== -1) h = h.slice(0, pct)
  if (!h.includes(":")) return null
  if (h.includes(".")) {
    const idx = h.lastIndexOf(":")
    const v4Parts = h.slice(idx + 1).split(".")
    if (v4Parts.length !== 4) return null
    const bytes: number[] = []
    for (const p of v4Parts) {
      if (!/^\d{1,3}$/.test(p)) return null
      const n = Number.parseInt(p, 10)
      if (n > 255) return null
      bytes.push(n)
    }
    const hi = (bytes[0] * 256 + bytes[1]).toString(16)
    const lo = (bytes[2] * 256 + bytes[3]).toString(16)
    h = `${h.slice(0, idx + 1)}${hi}:${lo}`
  }
  const parseGroups = (s: string): number[] | null => {
    if (s === "") return []
    const out: number[] = []
    for (const g of s.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(g)) return null
      out.push(Number.parseInt(g, 16))
    }
    return out
  }
  const doubleIdx = h.indexOf("::")
  if (doubleIdx !== -1) {
    if (doubleIdx !== h.lastIndexOf("::")) return null
    const left = parseGroups(h.slice(0, doubleIdx))
    const right = parseGroups(h.slice(doubleIdx + 2))
    if (!left || !right || left.length + right.length > 7) return null
    return [...left, ...Array(8 - left.length - right.length).fill(0), ...right]
  }
  const groups = parseGroups(h)
  return groups && groups.length === 8 ? groups : null
}

function isPrivateIpv6(groups: number[]): boolean {
  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0) {
    // ::ffff:0:0/96 IPv4-mapped and ::/96 IPv4-compatible/unspecified/loopback
    if (g5 === 0xffff || g5 === 0) {
      const v4 = g6 * 0x10000 + g7
      if (g5 === 0 && (v4 === 0 || v4 === 1)) return true // :: and ::1
      return isPrivateIpv4(v4)
    }
  }
  if ((g0 & 0xfe00) === 0xfc00) return true // fc00::/7 unique-local
  if ((g0 & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
  return false
}

export function isPrivateHostname(hostname: string): boolean {
  if (hostname.includes(":") || hostname.startsWith("[")) {
    const groups = parseIpv6(hostname)
    if (groups) return isPrivateIpv6(groups)
    return PRIVATE_HOSTNAME_RE.test(hostname)
  }
  const ipv4 = parseIpv4(hostname)
  if (ipv4 !== null) return isPrivateIpv4(ipv4)
  return PRIVATE_HOSTNAME_RE.test(hostname)
}

export type ResolvedHostnameClass = "private" | "public" | "unresolved"

/**
 * Resolves `hostname` and classifies what came back.
 *
 * This closes the gap left by `isPrivateHostname` alone: a public-looking DNS
 * name can still resolve inward (misconfiguration or deliberate rebinding),
 * and the fetch connects to whatever the resolver returns rather than to the
 * string that was checked.
 *
 * "unresolved" is reported separately rather than folded into "public",
 * because the safe answer differs by caller. `fetch` resolves independently of
 * this lookup, so a name whose authoritative server answers SERVFAIL here and
 * returns a private A record there would slip past a check that treats a
 * failed lookup as safe. That matters where the hostname is untrusted and not
 * where it is the operator's own.
 */
export async function classifyResolvedHostname(
  hostname: string,
): Promise<ResolvedHostnameClass> {
  let addresses: string[]
  try {
    const results = await lookup(hostname, { all: true, verbatim: true })
    addresses = results.map(r => r.address)
  } catch {
    return "unresolved"
  }
  if (addresses.length === 0) {
    return "unresolved"
  }
  return addresses.some(address => isPrivateHostname(address))
    ? "private"
    : "public"
}

/** Convenience for callers that only care whether resolution went inward. */
export async function isPrivateResolvedAddress(
  hostname: string,
): Promise<boolean> {
  return (await classifyResolvedHostname(hostname)) === "private"
}

export async function probeEndpoint(endpoint: string): Promise<ProbeResult> {
  const hostname = new URL(endpoint).hostname
  if (isPrivateHostname(hostname)) {
    return {
      status: 0,
      level: "warn",
      message: `Endpoint hostname "${hostname}" appears to be a private/internal address`,
    }
  }

  // Only "private" blocks here. The endpoint being probed is the operator's
  // own declared manifest endpoint, so a failed lookup is far more likely to
  // be a typo or an outage than an attack, and letting fetch report the real
  // network error is what makes this command useful.
  if ((await classifyResolvedHostname(hostname)) === "private") {
    return {
      status: 0,
      level: "warn",
      message: `Endpoint hostname "${hostname}" resolves to a private/internal address`,
    }
  }

  let response: globalThis.Response
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      // Don't follow redirects — the manifest endpoint field should be the final URL
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    })
  } catch (err) {
    if (err instanceof DOMException && err.name === "TimeoutError") {
      return {
        status: 0,
        level: "fail",
        message: "Endpoint probe timed out after 10s",
      }
    }
    return {
      status: 0,
      level: "fail",
      message: `Endpoint probe failed: ${err instanceof Error ? err.message : String(err)}`,
    }
  }

  const { status } = response

  if (status === 401 || status === 402 || status === 403) {
    return {
      status,
      level: "pass",
      message: `Endpoint returned ${status} — reachable and gate is enforcing`,
    }
  }

  if (status === 200) {
    return {
      status,
      level: "warn",
      message:
        "Endpoint returned 200 without authentication — gate may not be enforcing",
    }
  }

  if (status === 405) {
    return {
      status,
      level: "fail",
      message:
        "Endpoint returned 405 Method Not Allowed — likely a Vercel routing issue or static page shadowing the handler. Check that your handler serves POST requests at this URL.",
    }
  }

  if (status === 404) {
    return {
      status,
      level: "fail",
      message: "Endpoint returned 404 — handler not found at this URL",
    }
  }

  if (status >= 400 && status < 500) {
    return {
      status,
      level: "pass",
      message: `Endpoint reachable; request rejected by server (HTTP ${status})`,
    }
  }

  if (status >= 500 && status < 600) {
    return {
      status,
      level: "fail",
      message: `Endpoint returned ${status} server error — handler may be misconfigured`,
    }
  }

  return {
    status,
    level: "warn",
    message: `Endpoint returned unexpected status ${status}`,
  }
}

export function printProbeResult(result: ProbeResult): void {
  console.log(pc.cyan("\nEndpoint probe:"))
  console.log(
    `  POST ${result.status > 0 ? `→ HTTP ${result.status}` : "→ network error"}`,
  )

  if (result.level === "pass") {
    console.log(pc.green(`  PASS: ${result.message}`))
  } else if (result.level === "warn") {
    console.log(pc.yellow(`  WARN: ${result.message}`))
  } else {
    console.error(pc.red(`  FAIL: ${result.message}`))
  }
}
