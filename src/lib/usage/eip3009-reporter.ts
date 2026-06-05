import type { WalletClient } from "viem"
import { isAddress } from "viem"
import type { InvocationEvent } from "../../types.js"
import { signZeroValueAuthorization } from "./eip3009-auth.js"

export interface Eip3009UsageReporterConfig {
  /**
   * URL of the OpenSea usage endpoint.
   * Defaults to `https://api.opensea.io/api/v2/tools/usage`.
   */
  aggregatorUrl?: string
  /**
   * Viem WalletClient with an attached account — the **caller's** wallet.
   * Used to sign the zero-value EIP-3009 authorization proving the caller
   * controls the address.
   */
  walletClient: WalletClient
  /**
   * Chain ID for the EIP-712 USDC domain (e.g. 1 for Ethereum, 8453 for Base).
   */
  chainId: number
  /**
   * USDC token contract address. Defaults to the canonical USDC address
   * for the given `chainId`.
   */
  tokenAddress?: `0x${string}`
  /**
   * Tool operator or pricing recipient address — used as the `to` field
   * in the zero-value EIP-3009 authorization.
   */
  operatorAddress: `0x${string}`
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

const DEFAULT_AGGREGATOR_URL = "https://api.opensea.io/api/v2/tools/usage"
const DEFAULT_TIMEOUT_MS = 5_000

/**
 * Creates an `onInvocation` callback that reports tool usage via
 * EIP-3009 zero-value `TransferWithAuthorization` signatures.
 *
 * The **caller** signs the EIP-3009 message (`from` = caller address,
 * `to` = operator address, `value` = 0). The operator's SDK collects
 * this signature and forwards it to the usage endpoint along with the
 * ERC-8257 composite key identifying the tool.
 *
 * For **paid x402 calls** (where `event.paid && event.settlementTxHash`):
 * POSTs with `verification_type: "x402_settlement"` and the settlement
 * tx hash — no additional signature is needed.
 */
function validateConfig(config: Eip3009UsageReporterConfig): void {
  if (!isAddress(config.operatorAddress)) {
    throw new Error(
      `[tool-sdk] invalid operatorAddress: ${config.operatorAddress}`,
    )
  }
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
  if (
    !Number.isInteger(config.chainId) ||
    config.chainId <= 0
  ) {
    throw new Error(
      `[tool-sdk] chainId must be a positive integer, got: ${config.chainId}`,
    )
  }
  if (!config.apiKey?.trim()) {
    throw new Error("[tool-sdk] apiKey is required")
  }
  if (config.tokenAddress && !isAddress(config.tokenAddress)) {
    throw new Error(
      `[tool-sdk] invalid tokenAddress: ${config.tokenAddress}`,
    )
  }
  if (!config.walletClient.account) {
    throw new Error(
      "[tool-sdk] walletClient must have an account attached",
    )
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

    try {
      if (event.paid && event.settlementTxHash) {
        await fetch(aggregatorUrl, {
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
              caller_address: (event.callerAddress ??
                config.walletClient.account!.address) as `0x${string}`,
              tx_hash: event.settlementTxHash,
              chain_id: event.settlementChainId ?? config.chainId,
            },
          }),
          signal: controller.signal,
        }).then(handleResponse)
      } else if (event.paid && !event.settlementTxHash) {
        console.warn(
          "[tool-sdk] paid invocation without settlementTxHash — skipping usage report",
        )
        return
      } else {
        const callerAddress = config.walletClient.account!.address as `0x${string}`
        const auth = await signZeroValueAuthorization({
          walletClient: config.walletClient,
          from: callerAddress,
          to: config.operatorAddress,
          chainId: config.chainId,
          tokenAddress: config.tokenAddress,
        })

        await fetch(aggregatorUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": config.apiKey,
          },
          body: JSON.stringify({
            verification_type: "eip3009_authorization",
            tool_chain_id: config.toolChainId,
            tool_registry_address: config.toolRegistryAddress,
            tool_onchain_id: config.toolOnchainId,
            latency_ms: event.latencyMs,
            eip3009: {
              caller_address: callerAddress,
              signature: auth.signature,
              chain_id: auth.chainId,
              from: auth.from,
              to: auth.to,
              value: auth.value,
              valid_after: auth.validAfter,
              valid_before: auth.validBefore,
              nonce: auth.nonce,
            },
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
