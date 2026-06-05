import { isAddress } from "viem"

export interface X402UsageReporterConfig {
  /**
   * URL of the OpenSea usage endpoint.
   * Defaults to `https://api.opensea.io/api/v2/tools/usage`.
   */
  aggregatorUrl?: string
  /**
   * ERC-8257 composite key: chain where the tool is registered.
   */
  toolChainId: number
  /**
   * ERC-8257 composite key: registry contract address.
   */
  toolRegistryAddress: `0x${string}`
  /**
   * ERC-8257 composite key: the tool's onchain ID in the registry.
   */
  toolOnchainId: number
  /**
   * API key sent as `x-api-key` header.
   */
  apiKey: string
  /**
   * Request timeout in milliseconds. Defaults to 5000.
   */
  timeoutMs?: number
}

export interface X402UsageEvent {
  /** Address of the caller who paid. */
  callerAddress: `0x${string}`
  /** Onchain settlement transaction hash. */
  txHash: string
  /** Chain where the settlement tx occurred. */
  chainId: number
  /** Tool invocation latency in milliseconds. */
  latencyMs?: number
}

const DEFAULT_AGGREGATOR_URL = "https://api.opensea.io/api/v2/tools/usage"
const DEFAULT_TIMEOUT_MS = 5_000
const TX_HASH_REGEX = /^0x[0-9a-fA-F]{64}$/

function validateX402Config(config: X402UsageReporterConfig): void {
  if (!isAddress(config.toolRegistryAddress)) {
    throw new Error(
      `[tool-sdk] invalid toolRegistryAddress: ${config.toolRegistryAddress}`,
    )
  }
  if (
    !Number.isInteger(config.toolOnchainId) ||
    config.toolOnchainId < 0
  ) {
    throw new Error(
      `[tool-sdk] toolOnchainId must be a non-negative integer, got: ${config.toolOnchainId}`,
    )
  }
  if (
    !Number.isInteger(config.toolChainId) ||
    config.toolChainId <= 0
  ) {
    throw new Error(
      `[tool-sdk] toolChainId must be a positive integer, got: ${config.toolChainId}`,
    )
  }
  if (!config.apiKey?.trim()) {
    throw new Error("[tool-sdk] apiKey is required")
  }
}

/**
 * Creates a reporter for x402 settlement-based tool usage verification.
 *
 * Use this when the tool is paid via x402 and you have the onchain
 * settlement transaction hash. No wallet signing is required — the
 * backend verifies the settlement tx directly.
 */
export function createX402UsageReporter(
  config: X402UsageReporterConfig,
): (event: X402UsageEvent) => Promise<void> {
  validateX402Config(config)
  const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (event: X402UsageEvent): Promise<void> => {
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

    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const res = await fetch(aggregatorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
        },
        body: JSON.stringify({
          verification_type: "x402_settlement",
          tool_chain_id: config.toolChainId,
          tool_registry_address: config.toolRegistryAddress,
          tool_onchain_id: config.toolOnchainId,
          latency_ms: event.latencyMs,
          x402: {
            caller_address: event.callerAddress,
            tx_hash: event.txHash,
            chain_id: event.chainId,
          },
        }),
        signal: controller.signal,
      })

      if (!res.ok) {
        const text = (await res.text().catch(() => "<no body>")).slice(0, 256)
        console.error(
          `[tool-sdk] x402 usage report failed (${res.status}): ${text}`,
        )
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[tool-sdk] x402 usage report error:", err)
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
