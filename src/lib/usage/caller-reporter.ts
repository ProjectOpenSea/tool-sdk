import { isAddress } from "viem"
import { normalizeToolRegistryAddress } from "./tool-registry.js"

const NUMERIC_STRING_RE = /^\d+$/

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

/**
 * Outcome of a caller-side usage report. The reporters never throw; they
 * return one of these so callers (e.g. the `pay` CLI) can surface an accurate
 * status instead of assuming success.
 *
 * - `reported` — the aggregator accepted the report.
 * - `already-reported` — the tool's own server-side reporter recorded this
 *   settlement first; the usage is counted, the caller's report was a duplicate.
 * - `skipped` — nothing was sent (failed validation, no API key, insecure URL).
 * - `failed` — sent but rejected, or a network/timeout error.
 */
export type CallerUsageReportOutcome =
  | "reported"
  | "already-reported"
  | "skipped"
  | "failed"

export interface CallerUsageReportResult {
  outcome: CallerUsageReportOutcome
  /** Human-readable detail, present for `skipped` and `failed`. */
  detail?: string
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
  /**
   * ERC-8257 composite key identifying the tool onchain. Provide ALL THREE to
   * disambiguate when several tools are registered to the same endpoint URL —
   * the aggregator rejects an endpoint-only report with 400 in that case. When
   * present, these are sent in place of `toolEndpoint`, matching the
   * server-side reporter's payload.
   */
  toolChainId?: number
  toolRegistryAddress?: string
  toolOnchainId?: number | string
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

/**
 * Resolve which tool-identity fields to send: the ERC-8257 composite key when
 * its coordinates are supplied (all three required, and valid), otherwise the
 * endpoint URL. Returns an `error`/`detail` pair instead of throwing so the
 * caller can record a `skipped` outcome.
 */
function buildToolIdentity(
  event: CallerX402UsageEvent,
): { fields: Record<string, unknown> } | { error: string; detail: string } {
  const hasAny =
    event.toolChainId !== undefined ||
    event.toolRegistryAddress !== undefined ||
    event.toolOnchainId !== undefined
  if (!hasAny) {
    return { fields: { tool_endpoint: event.toolEndpoint } }
  }

  if (
    event.toolChainId === undefined ||
    event.toolRegistryAddress === undefined ||
    event.toolOnchainId === undefined
  ) {
    return {
      error:
        "tool coordinates must be provided together: toolChainId, toolRegistryAddress, and toolOnchainId",
      detail: "partial tool coordinates",
    }
  }
  if (!Number.isInteger(event.toolChainId) || event.toolChainId <= 0) {
    return {
      error: `toolChainId must be a positive integer, got: ${event.toolChainId}`,
      detail: "invalid toolChainId",
    }
  }
  if (!event.toolRegistryAddress) {
    return {
      error: "toolRegistryAddress must not be empty",
      detail: "invalid toolRegistryAddress",
    }
  }
  const onchainId = event.toolOnchainId
  if (typeof onchainId === "number") {
    if (!Number.isInteger(onchainId) || onchainId < 0) {
      return {
        error: `toolOnchainId must be a non-negative integer, got: ${onchainId}`,
        detail: "invalid toolOnchainId",
      }
    }
  } else if (!NUMERIC_STRING_RE.test(onchainId)) {
    return {
      error: `toolOnchainId must be a non-negative integer, got: ${onchainId}`,
      detail: "invalid toolOnchainId",
    }
  }

  return {
    fields: {
      tool_chain_id: event.toolChainId,
      tool_registry_address: normalizeToolRegistryAddress(
        event.toolRegistryAddress,
      ),
      tool_onchain_id: event.toolOnchainId,
    },
  }
}

// Bounded in practice: one entry per unique origin (typically 1–2).
const apiKeyCache = new Map<string, string>()
const pendingProvisions = new Map<string, Promise<string | undefined>>()

async function provisionApiKey(
  aggregatorUrl: string,
): Promise<string | undefined> {
  const origin = new URL(aggregatorUrl).origin
  const cached = apiKeyCache.get(origin)
  if (cached) return cached

  const pending = pendingProvisions.get(origin)
  if (pending) return pending

  const promise = (async (): Promise<string | undefined> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS)
    try {
      const res = await fetch(`${origin}/api/v2/auth/keys`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
        signal: controller.signal,
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
      clearTimeout(timer)
      pendingProvisions.delete(origin)
    }
    return undefined
  })()

  pendingProvisions.set(origin, promise)
  return promise
}

async function handleResponse(res: Response): Promise<CallerUsageReportResult> {
  if (res.ok) return { outcome: "reported" }
  const text = (await res.text().catch(() => "<no body>")).slice(0, 256)
  // The tool's own server-side reporter may have already recorded this
  // settlement (same tx hash), in which case the aggregator rejects the
  // caller's report as a duplicate. From the caller's perspective the usage
  // IS reported, so this is a success, not an error worth logging.
  if (
    res.status === 400 &&
    /already reported|duplicate usage report/i.test(text)
  ) {
    return { outcome: "already-reported" }
  }
  console.error(
    `[tool-sdk] caller usage report failed (${res.status}): ${text}`,
  )
  return { outcome: "failed", detail: `HTTP ${res.status}` }
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
): Promise<CallerUsageReportResult> {
  if (!isAddress(event.callerAddress)) {
    console.error(`[tool-sdk] invalid callerAddress: ${event.callerAddress}`)
    return { outcome: "skipped", detail: "invalid callerAddress" }
  }
  if (!TX_HASH_REGEX.test(event.txHash)) {
    console.error(
      `[tool-sdk] invalid txHash (expected 0x + 64 hex chars): ${event.txHash}`,
    )
    return { outcome: "skipped", detail: "invalid txHash" }
  }

  // Identify the tool either by its ERC-8257 composite key (preferred when an
  // endpoint maps to multiple registered tools) or by its endpoint URL.
  const toolIdentity = buildToolIdentity(event)
  if ("error" in toolIdentity) {
    console.error(`[tool-sdk] ${toolIdentity.error}`)
    return { outcome: "skipped", detail: toolIdentity.detail }
  }

  const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL
  if (!isSecureAggregatorUrl(aggregatorUrl)) {
    console.error(
      `[tool-sdk] refusing to send caller usage report over insecure aggregatorUrl (https required): ${aggregatorUrl}`,
    )
    return { outcome: "skipped", detail: "insecure aggregatorUrl" }
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const apiKey = config.apiKey ?? (await provisionApiKey(aggregatorUrl))
    if (!apiKey) {
      console.warn(
        "[tool-sdk] no API key available and auto-provisioning failed — skipping caller usage report",
      )
      return { outcome: "skipped", detail: "no API key available" }
    }

    const res = await fetch(aggregatorUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify({
        verification_type: "x402_settlement",
        ...toolIdentity.fields,
        latency_ms: event.latencyMs,
        x402: {
          caller_address: event.callerAddress,
          tx_hash: event.txHash,
          chain_id: event.chainId,
        },
      }),
      signal: controller.signal,
    })
    return await handleResponse(res)
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { outcome: "failed", detail: "timed out" }
    }
    console.error("[tool-sdk] caller x402 usage report error:", err)
    return {
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
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
): Promise<CallerUsageReportResult> {
  if (!isAddress(event.callerAddress)) {
    console.error(`[tool-sdk] invalid callerAddress: ${event.callerAddress}`)
    return { outcome: "skipped", detail: "invalid callerAddress" }
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
    return { outcome: "skipped", detail: "insecure aggregatorUrl" }
  }
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const apiKey = config.apiKey ?? (await provisionApiKey(aggregatorUrl))
    if (!apiKey) {
      console.warn(
        "[tool-sdk] no API key available and auto-provisioning failed — skipping caller usage report",
      )
      return { outcome: "skipped", detail: "no API key available" }
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
    return await handleResponse(res)
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      return { outcome: "failed", detail: "timed out" }
    }
    console.error("[tool-sdk] caller eip3009 usage report error:", err)
    return {
      outcome: "failed",
      detail: err instanceof Error ? err.message : String(err),
    }
  } finally {
    clearTimeout(timer)
  }
}
