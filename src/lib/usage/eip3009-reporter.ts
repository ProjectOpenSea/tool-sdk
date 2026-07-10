import type { InvocationEvent } from "../../types.js"

const NUMERIC_STRING_RE = /^\d+$/

export interface Eip3009UsageReporterConfig {
  /**
   * URL of the OpenSea usage endpoint.
   * Defaults to `https://api.opensea.io/api/v2/tools/usage`.
   */
  aggregatorUrl?: string
  /**
   * Chain ID used as the `chain_id` fallback for x402 settlement reports when
   * the gate did not record a settlement chain (e.g. 1 for Ethereum, 8453 for
   * Base). Forwarded EIP-3009 authorizations carry their own chain id.
   */
  chainId: number
  /**
   * ERC-8257 composite key: chain where the tool is registered.
   */
  toolChainId: number
  /**
   * ERC-8257 composite key: registry contract address.
   */
  toolRegistryAddress: string
  /**
   * Composite key: the tool's ID in the registry. A number (for onchain
   * tools that fit in a JS integer) or a numeric string (for x402 tools
   * whose IDs exceed `Number.MAX_SAFE_INTEGER`).
   */
  toolOnchainId: number | string
  /**
   * API key sent as `x-api-key` header. This authenticates the **tool
   * service** as the reporter.
   */
  apiKey: string
  /**
   * Request timeout in milliseconds. Defaults to 5000.
   */
  timeoutMs?: number
}

const DEFAULT_AGGREGATOR_URL = "https://api.opensea.io/api/v2/tools/usage"
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Creates a usage reporter for a tool **service** (the operator authenticates
 * with `apiKey`). Reporting is never done by the caller; the service proves
 * who called using data the caller already supplied:
 *
 * - **Paid x402 calls** (`event.paid && event.settlementTxHash`): POSTs
 *   `verification_type: "x402_settlement"` with the on-chain payer and
 *   settlement tx hash. The backend verifies the settlement directly.
 * - **EIP-3009-authenticated calls** (`event.callerAuthorization`, stashed by
 *   an auth gate): POSTs `verification_type: "eip3009_authorization"`,
 *   **forwarding the caller's original signed authorization**. The service
 *   never signs on the caller's behalf.
 *
 * Calls with neither a payment nor a caller authorization have no verifiable
 * caller identity and are skipped.
 */
function validateConfig(config: Eip3009UsageReporterConfig): void {
  if (!config.toolRegistryAddress) {
    throw new Error(`[tool-sdk] toolRegistryAddress must not be empty`)
  }
  const onchainId = config.toolOnchainId
  if (typeof onchainId === "number") {
    if (!Number.isInteger(onchainId) || onchainId < 0) {
      throw new Error(
        `[tool-sdk] toolOnchainId must be a non-negative integer, got: ${onchainId}`,
      )
    }
  } else if (!NUMERIC_STRING_RE.test(onchainId)) {
    throw new Error(
      `[tool-sdk] toolOnchainId must be a non-negative integer, got: ${onchainId}`,
    )
  }
  if (!Number.isInteger(config.toolChainId) || config.toolChainId <= 0) {
    throw new Error(
      `[tool-sdk] toolChainId must be a positive integer, got: ${config.toolChainId}`,
    )
  }
  if (!Number.isInteger(config.chainId) || config.chainId <= 0) {
    throw new Error(
      `[tool-sdk] chainId must be a positive integer, got: ${config.chainId}`,
    )
  }
  if (!config.apiKey?.trim()) {
    throw new Error("[tool-sdk] apiKey is required")
  }
}

export function createEip3009UsageReporter(
  config: Eip3009UsageReporterConfig,
): (event: InvocationEvent) => Promise<void> {
  validateConfig(config)
  const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (event: InvocationEvent): Promise<void> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    timer = setTimeout(() => controller.abort(), timeoutMs)

    const post = (body: unknown): Promise<void> =>
      fetch(aggregatorUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": config.apiKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      }).then(handleResponse)

    try {
      if (event.paid && event.settlementTxHash) {
        // Paid x402 call: attribute to the on-chain payer. `callerAddress` is
        // only set when an auth gate ran; otherwise fall back to the x402
        // payer (the actual caller).
        const caller =
          event.callerAddress ?? (event.payer as `0x${string}` | undefined)
        if (!caller) {
          console.warn(
            "[tool-sdk] x402 invocation without a resolvable caller address — skipping usage report",
          )
          return
        }
        await post({
          verification_type: "x402_settlement",
          tool_chain_id: config.toolChainId,
          tool_registry_address: config.toolRegistryAddress,
          tool_onchain_id: config.toolOnchainId,
          latency_ms: event.latencyMs,
          x402: {
            caller_address: caller,
            tx_hash: event.settlementTxHash,
            chain_id: event.settlementChainId ?? config.chainId,
          },
        })
      } else if (event.paid && !event.settlementTxHash) {
        console.warn(
          "[tool-sdk] paid invocation without settlementTxHash — skipping usage report",
        )
        return
      } else if (event.callerAuthorization) {
        // Server-side path: forward the caller's *original* signed
        // authorization. The caller already proved control of `from`; the
        // server must not re-sign as itself.
        const a = event.callerAuthorization
        await post({
          verification_type: "eip3009_authorization",
          tool_chain_id: config.toolChainId,
          tool_registry_address: config.toolRegistryAddress,
          tool_onchain_id: config.toolOnchainId,
          latency_ms: event.latencyMs,
          eip3009: {
            caller_address: a.from,
            signature: a.signature,
            chain_id: a.chainId,
            from: a.from,
            to: a.to,
            value: a.value,
            valid_after: a.validAfter,
            valid_before: a.validBefore,
            nonce: a.nonce,
          },
        })
      } else {
        console.warn(
          "[tool-sdk] invocation with no x402 payment and no caller authorization — nothing to attribute, skipping usage report",
        )
        return
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        console.error("[tool-sdk] eip3009 usage report error:", err)
      }
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

async function handleResponse(res: Response): Promise<void> {
  if (!res.ok) {
    const text = (await res.text().catch(() => "<no body>")).slice(0, 256)
    console.error(
      `[tool-sdk] eip3009 usage report failed (${res.status}): ${text}`,
    )
  }
}
