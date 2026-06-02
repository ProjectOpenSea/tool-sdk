import type { WalletClient } from "viem"
import type { InvocationEvent } from "../../types.js"
import { signZeroValueAuthorization } from "./eip3009-auth.js"
import { deriveSlug } from "../utils.js"

export interface Eip3009UsageReporterConfig {
  /**
   * URL of the OpenSea usage aggregator endpoint.
   * Defaults to `https://api.opensea.io/api/v2/agent-tools/usage`.
   */
  aggregatorUrl?: string
  /**
   * Viem WalletClient with an attached account, used to sign the
   * zero-value EIP-3009 authorization.
   */
  walletClient: WalletClient
  /**
   * Chain ID for the EIP-712 domain (e.g. 8453 for Base).
   */
  chainId: number
  /**
   * USDC token contract address. Defaults to the canonical USDC address
   * for Base (8453) or Base Sepolia (84532).
   */
  tokenAddress?: `0x${string}`
  /**
   * Tool slug derived from the tool name. If not provided, it is derived
   * from the manifest name attached to the invocation event.
   */
  toolSlug?: string
  /**
   * Request timeout in milliseconds. Defaults to 5000.
   */
  timeoutMs?: number
}

const DEFAULT_AGGREGATOR_URL =
  "https://api.opensea.io/api/v2/agent-tools/usage"
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Creates an `onInvocation` callback that reports tool usage via
 * EIP-3009 zero-value `TransferWithAuthorization` signatures.
 *
 * For **free / gated calls**: signs a zero-value authorization proving
 * the caller controls the wallet, and POSTs with
 * `verification_type: "eip3009_authorization"`.
 *
 * For **paid x402 calls** (where `event.paid && event.settlementTxHash`):
 * POSTs with `verification_type: "x402_settlement"` and the settlement
 * tx hash — no additional signature is needed.
 *
 * This replaces the SIWE-based `createUsageReporter`. Unlike SIWE, it
 * does not require the caller to have passed through a SIWE gate; the
 * tool operator signs directly.
 */
export function createEip3009UsageReporter(
  config: Eip3009UsageReporterConfig,
): (event: InvocationEvent) => Promise<void> {
  const aggregatorUrl = config.aggregatorUrl ?? DEFAULT_AGGREGATOR_URL
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  return async (event: InvocationEvent): Promise<void> => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    timer = setTimeout(() => controller.abort(), timeoutMs)

    try {
      const callerAddress =
        event.callerAddress ??
        (config.walletClient.account?.address as `0x${string}` | undefined)
      const toolSlug = config.toolSlug ?? deriveSlug(event.toolName ?? "")

      if (event.paid && event.settlementTxHash) {
        await fetch(aggregatorUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verification_type: "x402_settlement",
            tx_hash: event.settlementTxHash,
            caller_address: callerAddress,
            tool_slug: toolSlug,
            latency_ms: event.latencyMs,
          }),
          signal: controller.signal,
        }).then(handleResponse)
      } else if (event.paid && !event.settlementTxHash) {
        console.warn(
          "[tool-sdk] paid invocation without settlementTxHash — skipping usage report",
        )
        return
      } else {
        const auth = await signZeroValueAuthorization({
          walletClient: config.walletClient,
          from: config.walletClient.account!.address,
          to: "0x0000000000000000000000000000000000000000",
          chainId: config.chainId,
          tokenAddress: config.tokenAddress,
        })

        await fetch(aggregatorUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            verification_type: "eip3009_authorization",
            caller_address: callerAddress,
            signature: auth.signature,
            tool_slug: toolSlug,
            chain_id: auth.chainId,
            from: auth.from,
            to: auth.to,
            value: auth.value,
            valid_after: auth.validAfter,
            valid_before: auth.validBefore,
            nonce: auth.nonce,
            latency_ms: event.latencyMs,
          }),
          signal: controller.signal,
        }).then(handleResponse)
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
