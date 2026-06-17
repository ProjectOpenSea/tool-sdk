import { isAddress } from "viem"

/**
 * Configuration for caller-side usage reporting. Unlike the server-side
 * reporters, this identifies the tool by its canonical endpoint URL — the
 * backend resolves the onchain registry coordinates automatically.
 */
export interface CallerUsageReporterConfig {
  /**
   * URL of the OpenSea usage endpoint.
   * Defaults to `https://api.opensea.io/api/v2/tools/usage`.
   */
  aggregatorUrl?: string
  /**
   * API key sent as `x-api-key` header. When omitted the reporter
   * auto-provisions an instant API key via `POST /api/v2/auth/keys`.
   */
  apiKey?: string
  /**
   * Request timeout in milliseconds. Defaults to 5000.
   */
  timeoutMs?: number
}

export interface CallerX402UsageEvent {
  /** The tool's canonical endpoint URL (used for server-side lookup). */
  toolEndpoint: string
  /** Address of the caller who paid. */
  callerAddress: `0x${string}`
  /** Onchain settlement transaction hash. */
  txHash: string
  /** Chain where the settlement tx occurred. */
  chainId: number
  /** Tool invocation latency in milliseconds. */
  latencyMs?: number
}

export interface CallerEip3009UsageEvent {
  /** The tool's canonical endpoint URL (used for server-side lookup). */
  toolEndpoint: string
  /** Caller wallet address. */
  callerAddress: `0x${string}`
  /** EIP-3009 signature. */
  signature: `0x${string}`
  /** Chain ID the authorization was signed for. */
  chainId: number
  from: `0x${string}`
  to: `0x${string}`
  value: string
  validAfter: string
  validBefore: string
  nonce: string
  /** Tool invocation latency in milliseconds. */
  latencyMs?: number
}

const DEFAULT_AGGREGATOR_URL = "https://api.opensea.io/api/v2/tools/usage"
const DEFAULT_TIMEOUT_MS = 5_000
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

// Bounded in practice: one entry per unique origin (typically 1–2).
const apiKeyCache = new Map<string, string>()
const pendingProvisions = new Map<string, Promise<string | undefined>>()

async function provisionApiKey(
  aggregatorUrl: string,
  signal: AbortSignal,
): Promise<string | undefined> {
  const origin = new URL(aggregatorUrl).origin
  const cached = apiKeyCache.get(origin)
  if (cached) return cached

  const pending = pendingProvisions.get(origin)
  if (pending) return pending

  const promise = (async (): Promise<string | undefined> => {
    try {
      const res = await fetch(`${origin}/api/v2/auth/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal,
      })
      if (res.ok) {
        const data = (await res.json()) as { api_key?: string }
        if (data.api_key) {
          apiKeyCache.set(origin, data.api_key)
          return data.api_key
        }
      }
    } catch {
      // Auto-provisioning failed; caller will be warned below.
    } finally {
      pendingProvisions.delete(origin)
    }
    return undefined
  })()

  pendingProvisions.set(origin, promise)
  return promise
}

async function handleResponse(res: Response): Promise<void> {
  if (!res.ok) {
    const text = (await res.text().catch(() => "<no body>")).slice(0, 256)
    console.error(
      `[tool-sdk] caller usage report failed (${res.status}): ${text}`,
    )
  }
}

/**
 * The report carries an API key and payment attestation data, so it must
 * never travel in plaintext. Require `https`, allowing `http://localhost`
 * (and `127.0.0.1`) only for local development.
 */
function isSecureAggregatorUrl(aggregatorUrl: string): boolean {
  try {
    const url = new URL(aggregatorUrl)
    if (url.protocol === "https:") return true
    return (
      url.protocol === "http:" &&
      (url.hostname === "localhost" || url.hostname === "127.0.0.1")
    )
  } catch {
    return false
  }
}

/**
 * Reports an x402 settlement as a caller. Identifies the tool by endpoint URL
 * so the caller doesn't need onchain registry coordinates. Auto-provisions an
 * instant API key if none is configured.
 */
export async function reportCallerX402Usage(
  event: CallerX402UsageEvent,
  config: CallerUsageReporterConfig = {},
): Promise<void> {
  if (!isAddress(event.callerAddress)) {
    console.error(
      `[tool-sdk] invalid callerAddress: ${event.callerAddress}`,
    )
    return
  }
  if (!TX_HASH_REGEX.test(event.txHash)) {
    console.error(
      `[tool-sdk] invalid txHash (expected 0x + 64 hex chars): ${event.txHash}`,
    )
    return
  }

  const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL
  if (!isSecureAggregatorUrl(aggregatorUrl)) {
    console.error(
      `[tool-sdk] refusing to send caller usage report over insecure aggregatorUrl (https required): ${aggregatorUrl}`,
    )
    return
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const apiKey =
      config.apiKey ?? (await provisionApiKey(aggregatorUrl, controller.signal))
    if (!apiKey) {
      console.warn(
        "[tool-sdk] no API key available and auto-provisioning failed — skipping caller usage report",
      )
      return
    }

    const res = await fetch(aggregatorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        verification_type: "x402_settlement",
        tool_endpoint: event.toolEndpoint,
        latency_ms: event.latencyMs,
        x402: {
          caller_address: event.callerAddress,
          tx_hash: event.txHash,
          chain_id: event.chainId,
        },
      }),
      signal: controller.signal,
    })
    await handleResponse(res)
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error("[tool-sdk] caller x402 usage report error:", err)
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Reports an EIP-3009 authorization as a caller. Identifies the tool by
 * endpoint URL. Auto-provisions an instant API key if none is configured.
 *
 * SECURITY: the payload contains a complete, replayable
 * `transferWithAuthorization` (signature plus from/to/value/nonce/validAfter/
 * validBefore). Only call this AFTER the authorization is consumed onchain, or
 * for the zero-value identity authorizations used by predicate gates.
 * Reporting a non-zero authorization whose nonce is not yet consumed exposes it
 * to front-running if the aggregator endpoint is compromised. The aggregator
 * URL is required to be https for the same reason.
 */
export async function reportCallerEip3009Usage(
  event: CallerEip3009UsageEvent,
  config: CallerUsageReporterConfig = {},
): Promise<void> {
  if (!isAddress(event.callerAddress)) {
    console.error(
      `[tool-sdk] invalid callerAddress: ${event.callerAddress}`,
    )
    return
  }
  if (event.value !== "0") {
    console.warn(
      `[tool-sdk] reportCallerEip3009Usage called with non-zero value (${event.value}); only report authorizations already settled onchain — reporting an unconsumed authorization risks front-running`,
    )
  }

  const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL
  if (!isSecureAggregatorUrl(aggregatorUrl)) {
    console.error(
      `[tool-sdk] refusing to send caller usage report over insecure aggregatorUrl (https required): ${aggregatorUrl}`,
    )
    return
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const apiKey =
      config.apiKey ?? (await provisionApiKey(aggregatorUrl, controller.signal))
    if (!apiKey) {
      console.warn(
        "[tool-sdk] no API key available and auto-provisioning failed — skipping caller usage report",
      )
      return
    }

    const res = await fetch(aggregatorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        verification_type: "eip3009_authorization",
        tool_endpoint: event.toolEndpoint,
        latency_ms: event.latencyMs,
        eip3009: {
          caller_address: event.callerAddress,
          signature: event.signature,
          chain_id: event.chainId,
          from: event.from,
          to: event.to,
          value: event.value,
          valid_after: event.validAfter,
          valid_before: event.validBefore,
          nonce: event.nonce,
        },
      }),
      signal: controller.signal,
    })
    await handleResponse(res)
  } catch (err) {
    if ((err as Error).name !== "AbortError") {
      console.error("[tool-sdk] caller eip3009 usage report error:", err)
    }
  } finally {
    clearTimeout(timer)
  }
}
