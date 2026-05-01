import pc from "picocolors"

export interface ProbeResult {
  status: number
  level: "pass" | "warn" | "fail"
  message: string
}

const PRIVATE_HOSTNAME_RE =
  /^(localhost|127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|\[?::1\]?|\[?fe80:)/i

export function isPrivateHostname(hostname: string): boolean {
  return PRIVATE_HOSTNAME_RE.test(hostname)
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
